import { createCanvas, cloneCanvas, Rect } from '../util.js';
import { pixelItem } from '../history.js';
import { toCss } from '../color.js';

export class Tool {
  constructor(app, meta) {
    this.app = app;
    Object.assign(this, meta); // id, name, icon, key, hint, options
  }
  get doc() { return this.app.activeDoc; }
  get settings() { return this.app.toolSettings; }
  activate() {}
  deactivate() { this.commit(); }
  commit() {}
  cancel() {}
  get hasPending() { return false; }
  onPointerDown() {}
  onPointerMove() {}
  onPointerUp() {}
  onHover() {}
  onKeyDown() { return false; }
  onSettingChanged() {}
  drawOverlay() {}
  getCursor() { return this.cursor || 'crosshair'; }
  get selectionMatrix() { return null; }
  get hidesSelection() { return false; }
  render() { this.app.view.requestRender(); }
}

// Map toolbar blend setting → layer composite operation
export const PAINT_BLEND = {
  normal: 'source-over', overwrite: 'overwrite', multiply: 'multiply', additive: 'lighter', colorburn: 'color-burn',
  colordodge: 'color-dodge', overlay: 'overlay', difference: 'difference', lighten: 'lighten', darken: 'darken',
  screen: 'screen', xor: 'xor', hardlight: 'hard-light', softlight: 'soft-light', color: 'color',
  luminosity: 'luminosity', hue: 'hue', saturation: 'saturation',
};

// Paints into a layer through a coverage mask while honoring the selection clip, blend mode and alpha.
// Usage: draw coverage (white) into `this.mask`, then call compose(rect).
export class StrokeCompositor {
  constructor(doc, layer = doc.activeLayer) {
    this.doc = doc;
    this.layer = layer;
    this.before = cloneCanvas(layer.canvas);
    this.mask = createCanvas(layer.width, layer.height);
    this.mctx = this.mask.getContext('2d');
    this.tmp = createCanvas(layer.width, layer.height);
    this.clip = doc.selection.clip;
    this.dirty = null;
    this.color = { r: 0, g: 0, b: 0, a: 255 };
    this.mode = 'source-over';
    this.source = null; // canvas used instead of a flat color (clone stamp, gradients)
    this.sourceOffset = { x: 0, y: 0 };
    this.antialias = true;
    this.direct = false;
  }

  threshold(r) {
    r = Rect.clip(r, this.mask.width, this.mask.height);
    if (!r) return;
    const img = this.mctx.getImageData(r.x, r.y, r.w, r.h), d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
    this.mctx.putImageData(img, r.x, r.y);
  }

  compose(rect) {
    const r = Rect.clip(Rect.inflate(rect, 1), this.layer.width, this.layer.height);
    if (!r) return;
    if (!this.antialias) this.threshold(r);
    this.dirty = Rect.union(this.dirty, r);
    const T = this.tmp.getContext('2d');
    T.save();
    T.beginPath(); T.rect(r.x, r.y, r.w, r.h); T.clip();
    T.clearRect(r.x, r.y, r.w, r.h);
    if (this.direct) {
      // The mask already holds final colors (text, shapes, lines).
      T.drawImage(this.mask, 0, 0);
    } else {
      T.drawImage(this.mask, 0, 0);
      T.globalCompositeOperation = 'source-in';
      if (this.source) T.drawImage(this.source, this.sourceOffset.x, this.sourceOffset.y);
      else { T.fillStyle = toCss({ ...this.color, a: 255 }); T.fillRect(r.x, r.y, r.w, r.h); }
    }
    if (this.clip) { T.globalCompositeOperation = 'destination-in'; T.drawImage(this.clip, 0, 0); }
    T.restore();

    const L = this.layer.ctx;
    L.save();
    L.beginPath(); L.rect(r.x, r.y, r.w, r.h); L.clip();
    L.clearRect(r.x, r.y, r.w, r.h);
    L.drawImage(this.before, 0, 0);
    const alpha = this.mode === 'destination-out' ? 1 : this.color.a / 255;
    if (this.mode === 'overwrite') {
      L.globalCompositeOperation = 'destination-out';
      L.drawImage(this.tmp, 0, 0);
      L.globalCompositeOperation = 'source-over';
    } else {
      L.globalCompositeOperation = this.mode;
    }
    L.globalAlpha = this.source ? 1 : alpha;
    L.drawImage(this.tmp, 0, 0);
    L.restore();
    this.doc.invalidate(r);
  }

  // Push an undo item for everything painted. Returns false if nothing changed.
  finish(name, icon) {
    if (!this.dirty) return false;
    this.doc.history.push(pixelItem(this.doc, this.layer, this.dirty, this.before, name, icon));
    this.dirty = null;
    return true;
  }

  cancel() {
    if (!this.dirty) return;
    const L = this.layer.ctx, r = this.dirty;
    L.clearRect(r.x, r.y, r.w, r.h);
    L.drawImage(this.before, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    this.doc.invalidate(r);
    this.dirty = null;
  }
}

// paint.net's color distance test
export function colorTolerance(tol01) {
  const t = Math.floor(tol01 * tol01 * 256);
  return t * t * 4;
}

export function colorClose(d, i, r, g, b, a, limit) {
  const da = d[i + 3];
  let sum = 0, diff;
  diff = d[i] - r; sum += ((1 + diff * diff) * da) >> 8;
  diff = d[i + 1] - g; sum += ((1 + diff * diff) * da) >> 8;
  diff = d[i + 2] - b; sum += ((1 + diff * diff) * da) >> 8;
  diff = da - a; sum += diff * diff;
  return sum <= limit;
}

// Flood fill returning a 0/1 mask. data is RGBA Uint8ClampedArray of w*h.
export function floodMask(data, w, h, sx, sy, tol01, global) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  const out = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const si = (sy * w + sx) * 4;
  const r = data[si], g = data[si + 1], b = data[si + 2], a = data[si + 3];
  const limit = colorTolerance(tol01);
  if (global) {
    for (let p = 0, i = 0; p < w * h; p++, i += 4) if (colorClose(data, i, r, g, b, a, limit)) out[p] = 1;
    return out;
  }
  const seen = new Uint8Array(w * h);
  const stack = [sx, sy];
  const ok = (x, y) => { const p = y * w + x; return !seen[p] && colorClose(data, p * 4, r, g, b, a, limit); };
  while (stack.length) {
    const y = stack.pop(), x0 = stack.pop();
    if (!ok(x0, y)) continue;
    let x1 = x0, x2 = x0;
    while (x1 > 0 && ok(x1 - 1, y)) x1--;
    while (x2 < w - 1 && ok(x2 + 1, y)) x2++;
    let upOpen = false, downOpen = false;
    for (let x = x1; x <= x2; x++) {
      const p = y * w + x;
      seen[p] = 1; out[p] = 1;
      if (y > 0) {
        const u = ok(x, y - 1);
        if (u && !upOpen) { stack.push(x, y - 1); upOpen = true; } else if (!u) upOpen = false;
      }
      if (y < h - 1) {
        const dn = ok(x, y + 1);
        if (dn && !downOpen) { stack.push(x, y + 1); downOpen = true; } else if (!dn) downOpen = false;
      }
    }
  }
  return out;
}

export function maskToCanvas(mask, w, h) {
  const c = createCanvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) if (mask[p]) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function maskBounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Pixel data of either the active layer or the flattened image.
export function sampleData(doc, sampling) {
  const src = sampling === 'image' ? doc.flatten() : doc.activeLayer.canvas;
  return src.getContext('2d').getImageData(0, 0, doc.width, doc.height).data;
}

// Selection combine mode from toolbar + modifiers (paint.net conventions)
export function selectionMode(app, e) {
  const base = app.toolSettings.selectionMode;
  if (e.button === 2) return e.altKey ? 'intersect' : 'xor';
  if (e.ctrlKey || e.metaKey) return 'union';
  if (e.altKey) return 'exclude';
  return base;
}

// Square handle drawing in screen space
export function drawHandle(ctx, x, y, size = 7, round = false) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (round) ctx.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, size / 2 + 0.5, 0, Math.PI * 2);
  else ctx.rect(Math.round(x - size / 2) + 0.5, Math.round(y - size / 2) + 0.5, size, size);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export const HANDLE_HIT = 7; // screen px

// Builds a cursor from an SVG icon body with a crosshair hotspot.
const cursorCache = new Map();
export function toolCursor(iconSvg, fallback = 'crosshair') {
  if (!iconSvg) return fallback;
  if (cursorCache.has(iconSvg)) return cursorCache.get(iconSvg);
  const inner = iconSvg.replace(/<svg[^>]*>/, '').replace('</svg>', '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" stroke-linecap="round" stroke-linejoin="round" color="#000">` +
    `<path d="M8 0v6M8 10v6M0 8h6M10 8h6" stroke="#fff" stroke-width="3"/><path d="M8 0v6M8 10v6M0 8h6M10 8h6" stroke="#000" stroke-width="1"/>` +
    `<g transform="translate(14 14)">${inner}</g></svg>`;
  const css = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 8 8, ${fallback}`;
  cursorCache.set(iconSvg, css);
  return css;
}
