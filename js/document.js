import { Emitter, createCanvas, cloneCanvas, Rect, uid } from './util.js';
import { History } from './history.js';
import { Selection } from './selection.js';
import { t } from './i18n.js';

export const BLEND_MODES = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['additive', 'Additive'], ['colorburn', 'Color Burn'],
  ['colordodge', 'Color Dodge'], ['reflect', 'Reflect'], ['glow', 'Glow'], ['overlay', 'Overlay'],
  ['difference', 'Difference'], ['negation', 'Negation'], ['lighten', 'Lighten'], ['darken', 'Darken'],
  ['screen', 'Screen'], ['xor', 'Xor'], ['hardlight', 'Hard Light'], ['softlight', 'Soft Light'],
  ['color', 'Color'], ['luminosity', 'Luminosity'], ['hue', 'Hue'], ['saturation', 'Saturation'],
];

export const CANVAS_OPS = {
  normal: 'source-over', multiply: 'multiply', additive: 'lighter', colorburn: 'color-burn',
  colordodge: 'color-dodge', overlay: 'overlay', difference: 'difference', lighten: 'lighten',
  darken: 'darken', screen: 'screen', hardlight: 'hard-light', softlight: 'soft-light',
  color: 'color', luminosity: 'luminosity', hue: 'hue', saturation: 'saturation',
};

// Separable blend functions for modes the canvas API lacks (values 0..1).
const CUSTOM = {
  reflect: (b, s) => (s >= 1 ? 1 : Math.min(1, (b * b) / (1 - s))),
  glow: (b, s) => (b >= 1 ? 1 : Math.min(1, (s * s) / (1 - b))),
  negation: (b, s) => 1 - Math.abs(1 - b - s),
  xor: (b, s) => (((b * 255) | 0) ^ ((s * 255) | 0)) / 255,
};

export class Layer {
  constructor(w, h, name = 'Layer') {
    this.id = uid();
    this.name = name;
    this.canvas = createCanvas(w, h);
    this.visible = true;
    this.opacity = 255;
    this.blendMode = 'normal';
  }
  get ctx() { return this.canvas.getContext('2d'); }
  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
  clone(name) {
    const l = new Layer(1, 1, name ?? this.name);
    l.canvas = cloneCanvas(this.canvas);
    l.visible = this.visible; l.opacity = this.opacity; l.blendMode = this.blendMode;
    return l;
  }
  static fromCanvas(canvas, name) {
    const l = new Layer(1, 1, name);
    l.canvas = canvas;
    return l;
  }
}

let untitled = 0;
export function nextUntitled() { untitled++; return t('Untitled') + (untitled > 1 ? ` ${untitled}` : ''); }
// Keep the "Untitled N" counter ahead of names restored from storage.
function noteName(name) {
  const m = /^(?:Untitled|Unbenannt)(?: (\d+))?(?:\.\w+)?$/.exec(name || '');
  if (m) untitled = Math.max(untitled, m[1] ? +m[1] : 1);
}

export class Document extends Emitter {
  constructor(w, h, opts = {}) {
    super();
    this.id = opts.id || 'doc' + Date.now().toString(36) + uid();
    this.width = w;
    this.height = h;
    if (opts.name) noteName(opts.name);
    this.name = opts.name || nextUntitled();
    this.dpi = opts.dpi || 96;
    this.layers = [];
    this.activeIndex = 0;
    this.selection = new Selection(w, h);
    this.history = new History(opts.baseName || 'New Image', opts.baseIcon || 'new');
    this.fileHandle = null;
    this.fileType = opts.fileType || null;
    this.composite = createCanvas(w, h);
    this._dirty = { x: 0, y: 0, w, h };
    this._savedItem = this.history.top;
    this.view = null; // per-document view state (zoom/scroll), owned by CanvasView
    this.history.on('change', () => this.emit('history'));
    if (opts.background !== undefined) {
      const bg = new Layer(w, h, t('Background'));
      if (opts.background) {
        const c = bg.ctx;
        c.fillStyle = opts.background;
        c.fillRect(0, 0, w, h);
      }
      this.layers.push(bg);
    }
  }

  get activeLayer() { return this.layers[this.activeIndex]; }
  get dirty() { return this.history.top !== this._savedItem; }
  markSaved() { this._savedItem = this.history.top; this.emit('meta'); }
  markDirty() { this._savedItem = null; this.emit('meta'); }

  setActiveLayer(i) {
    i = Math.max(0, Math.min(this.layers.length - 1, i));
    if (i === this.activeIndex) return;
    this.activeIndex = i;
    this.emit('activelayer');
  }

  compositeResized() {
    this.composite = createCanvas(this.width, this.height);
    this._dirty = { x: 0, y: 0, w: this.width, h: this.height };
  }

  invalidate(rect) {
    const full = { x: 0, y: 0, w: this.width, h: this.height };
    const r = rect ? Rect.clip(rect, this.width, this.height) : full;
    if (!r) return;
    this._dirty = Rect.union(this._dirty, r);
    this.emit('pixels', r);
  }

  getComposite() {
    if (this._dirty) {
      this.renderComposite(this.composite, this._dirty);
      this._dirty = null;
    }
    return this.composite;
  }

  // Composite visible layers into `target` within rect.
  renderComposite(target, r = { x: 0, y: 0, w: this.width, h: this.height }, layers = this.layers) {
    const c = target.getContext('2d');
    c.save();
    c.beginPath();
    c.rect(r.x, r.y, r.w, r.h);
    c.clip();
    c.clearRect(r.x, r.y, r.w, r.h);
    for (const l of layers) {
      if (!l.visible || l.opacity === 0) continue;
      const op = CANVAS_OPS[l.blendMode];
      if (op) {
        c.globalCompositeOperation = op;
        c.globalAlpha = l.opacity / 255;
        c.drawImage(l.canvas, 0, 0);
      } else {
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
        blendCustom(c, l, r, CUSTOM[l.blendMode]);
      }
    }
    c.restore();
  }

  flatten() {
    const c = createCanvas(this.width, this.height);
    this.renderComposite(c);
    return c;
  }

  thumbnail(max = 64) {
    const s = Math.min(max / this.width, max / this.height, 1);
    const c = createCanvas(Math.max(1, Math.round(this.width * s)), Math.max(1, Math.round(this.height * s)));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(this.getComposite(), 0, 0, c.width, c.height);
    return c;
  }

  // Area that tools may modify (selection bounds or whole image)
  get editBounds() {
    return this.selection.empty ? { x: 0, y: 0, w: this.width, h: this.height } : { ...this.selection.bounds };
  }
}

function blendCustom(c, layer, r, fn) {
  const src = layer.ctx.getImageData(r.x, r.y, r.w, r.h).data;
  const dstImg = c.getImageData(r.x, r.y, r.w, r.h);
  const d = dstImg.data;
  const op = layer.opacity / 255;
  for (let i = 0; i < d.length; i += 4) {
    const as = (src[i + 3] / 255) * op;
    if (as === 0) continue;
    const ab = d[i + 3] / 255;
    const ao = as + ab * (1 - as);
    for (let k = 0; k < 3; k++) {
      const cs = src[i + k] / 255, cb = d[i + k] / 255;
      const co = as * (1 - ab) * cs + as * ab * fn(cb, cs) + (1 - as) * ab * cb;
      d[i + k] = Math.round((co / ao) * 255);
    }
    d[i + 3] = Math.round(ao * 255);
  }
  c.putImageData(dstImg, r.x, r.y);
}
