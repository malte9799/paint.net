import { Tool, StrokeCompositor, PAINT_BLEND, colorTolerance, colorClose, toolCursor } from './common.js';
import { Rect, clamp } from '../util.js';
import { iconSvg } from '../icons.js';

function segRect(a, b, r) {
  const x0 = Math.min(a.x, b.x) - r - 2, y0 = Math.min(a.y, b.y) - r - 2;
  return { x: x0, y: y0, w: Math.abs(a.x - b.x) + 2 * r + 4, h: Math.abs(a.y - b.y) + 2 * r + 4 };
}

const pressureOf = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1);

class BrushBase extends Tool {
  brushWidth() { return this.settings.brushWidth; }
  setupSession(s, e) {}
  onPointerDown(e, p) {
    if (!this.doc) return;
    const s = (this.session = new StrokeCompositor(this.doc));
    s.antialias = this.settings.antialias;
    this.setupSession(s, e);
    this.last = p;
    this.lastW = this.brushWidth() * pressureOf(e);
    this.stroke(p, p, this.lastW, this.lastW);
  }
  onPointerMove(e, p) {
    if (!this.session) return;
    const w = this.brushWidth() * pressureOf(e);
    this.stroke(this.last, p, this.lastW, w);
    this.last = p; this.lastW = w;
  }
  onPointerUp() {
    if (!this.session) return;
    this.session.finish(this.name, this.icon);
    this.session = null;
  }
  stroke(a, b, w0, w1) {
    const s = this.session, m = s.mctx;
    const hard = this.settings.hardness / 100;
    const r = Math.max(w0, w1) / 2;
    m.save();
    m.fillStyle = m.strokeStyle = '#fff';
    if (hard >= 0.999) {
      if (a.x === b.x && a.y === b.y) {
        m.beginPath(); m.arc(a.x, a.y, Math.max(0.5, w1 / 2), 0, Math.PI * 2); m.fill();
      } else {
        m.lineCap = 'round'; m.lineJoin = 'round';
        m.lineWidth = Math.max(1, (w0 + w1) / 2);
        m.beginPath(); m.moveTo(a.x, a.y); m.lineTo(b.x, b.y); m.stroke();
      }
    } else {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const spacing = Math.max(0.5, r * 0.12);
      const n = Math.max(1, Math.ceil(d / spacing));
      for (let i = a === b ? n : 1; i <= n; i++) {
        const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const rr = Math.max(0.5, (w0 + (w1 - w0) * t) / 2);
        const g = m.createRadialGradient(x, y, rr * hard, x, y, rr);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        m.fillStyle = g;
        m.beginPath(); m.arc(x, y, rr, 0, Math.PI * 2); m.fill();
      }
    }
    m.restore();
    s.compose(segRect(a, b, r));
  }
  drawOverlay(ctx, view) {
    const p = view.hover;
    if (!p) return;
    const sp = view.toScreen(p.x, p.y), r = (this.brushWidth() / 2) * view.zoom;
    if (r < 2) return;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 1, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.stroke();
  }
  getCursor() { return toolCursor(iconSvg(this.icon)); }
}

export class PaintbrushTool extends BrushBase {
  constructor(app) {
    super(app, {
      id: 'paintbrush', name: 'Paintbrush', icon: 't_paintbrush', key: 'B',
      hint: 'Left click to draw with primary color, right click to draw with secondary color.',
      options: ['brushWidth', 'hardness', 'antialias', 'blendMode'],
    });
  }
  setupSession(s, e) {
    s.color = e.button === 2 ? this.app.secondary : this.app.primary;
    s.mode = PAINT_BLEND[this.settings.blendMode] || 'source-over';
  }
}

export class EraserTool extends BrushBase {
  constructor(app) {
    super(app, {
      id: 'eraser', name: 'Eraser', icon: 't_eraser', key: 'E',
      hint: 'Click and drag to erase a portion of the image.',
      options: ['brushWidth', 'hardness', 'antialias'],
    });
  }
  setupSession(s) { s.mode = 'destination-out'; s.color = { r: 0, g: 0, b: 0, a: 255 }; }
}

export class PencilTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'pencil', name: 'Pencil', icon: 't_pencil', key: 'P',
      hint: 'Left click to draw freeform one-pixel wide lines with the primary color, right click to use the secondary color.',
      options: ['blendMode'],
    });
  }
  onPointerDown(e, p) {
    if (!this.doc) return;
    const s = (this.session = new StrokeCompositor(this.doc));
    s.color = e.button === 2 ? this.app.secondary : this.app.primary;
    s.mode = PAINT_BLEND[this.settings.blendMode] || 'source-over';
    s.antialias = true;
    this.last = { x: Math.floor(p.x), y: Math.floor(p.y) };
    this.line(this.last, this.last);
  }
  onPointerMove(e, p) {
    if (!this.session) return;
    const q = { x: Math.floor(p.x), y: Math.floor(p.y) };
    if (q.x === this.last.x && q.y === this.last.y) return;
    this.line(this.last, q);
    this.last = q;
  }
  onPointerUp() {
    if (!this.session) return;
    this.session.finish('Pencil', this.icon);
    this.session = null;
  }
  line(a, b) {
    const m = this.session.mctx;
    m.fillStyle = '#fff';
    let x0 = a.x, y0 = a.y;
    const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0), sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      m.fillRect(x0, y0, 1, 1);
      if (x0 === b.x && y0 === b.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    this.session.compose(segRect(a, b, 1));
  }
  getCursor() { return toolCursor(iconSvg(this.icon)); }
}

export class CloneStampTool extends BrushBase {
  constructor(app) {
    super(app, {
      id: 'clonestamp', name: 'Clone Stamp', icon: 't_clonestamp', key: 'L',
      hint: 'Ctrl+left click to set origin, left click to paint.',
      options: ['brushWidth', 'hardness', 'antialias', 'blendMode'],
    });
    this.origin = null;
    this.offset = null;
  }
  onPointerDown(e, p) {
    if (!this.doc) return;
    if (e.ctrlKey || e.metaKey) {
      this.origin = { x: p.x, y: p.y };
      this.offset = null;
      this.render();
      return;
    }
    if (!this.origin) { this.app.flashStatus('Hold Ctrl and click to set the clone origin first.'); return; }
    if (!this.offset) this.offset = { x: p.x - this.origin.x, y: p.y - this.origin.y };
    super.onPointerDown(e, p);
  }
  setupSession(s) {
    s.mode = PAINT_BLEND[this.settings.blendMode] || 'source-over';
    if (s.mode === 'overwrite') s.mode = 'source-over';
    s.source = s.before;
    s.sourceOffset = { x: Math.round(this.offset.x), y: Math.round(this.offset.y) };
  }
  drawOverlay(ctx, view) {
    super.drawOverlay(ctx, view);
    let src = null;
    if (this.offset && view.hover) src = { x: view.hover.x - this.offset.x, y: view.hover.y - this.offset.y };
    else if (this.origin) src = this.origin;
    if (!src) return;
    const sp = view.toScreen(src.x, src.y);
    const r = Math.max(4, (this.brushWidth() / 2) * view.zoom);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 3; ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(sp.x - 5, sp.y); ctx.lineTo(sp.x + 5, sp.y); ctx.moveTo(sp.x, sp.y - 5); ctx.lineTo(sp.x, sp.y + 5);
    ctx.strokeStyle = '#000'; ctx.stroke();
  }
}

export class RecolorTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'recolor', name: 'Recolor', icon: 't_recolor', key: 'R',
      hint: 'Left click to replace the secondary color with the primary color, right click to do the reverse.',
      options: ['brushWidth', 'tolerance', 'antialias'],
    });
  }
  onPointerDown(e, p) {
    const doc = this.doc;
    if (!doc) return;
    const s = (this.session = new StrokeCompositor(doc));
    const { primary, secondary } = this.app;
    this.from = e.button === 2 ? primary : secondary;
    this.to = e.button === 2 ? secondary : primary;
    this.beforeData = s.before.getContext('2d').getImageData(0, 0, doc.width, doc.height).data;
    this.selData = doc.selection.empty ? null : doc.selection.ctx.getImageData(0, 0, doc.width, doc.height).data;
    this.limit = colorTolerance(this.settings.tolerance);
    this.last = p;
    this.dab(p);
  }
  onPointerMove(e, p) {
    if (!this.session) return;
    const r = this.settings.brushWidth / 2;
    const d = Math.hypot(p.x - this.last.x, p.y - this.last.y);
    const n = Math.max(1, Math.ceil(d / Math.max(1, r / 3)));
    for (let i = 1; i <= n; i++) this.dab({ x: this.last.x + ((p.x - this.last.x) * i) / n, y: this.last.y + ((p.y - this.last.y) * i) / n });
    this.last = p;
  }
  onPointerUp() {
    if (!this.session) return;
    this.session.finish('Recolor', this.icon);
    this.session = null;
  }
  dab(p) {
    const doc = this.doc, s = this.session, W = doc.width;
    const rad = Math.max(0.5, this.settings.brushWidth / 2);
    const rect = Rect.clip({ x: p.x - rad - 1, y: p.y - rad - 1, w: rad * 2 + 2, h: rad * 2 + 2 }, doc.width, doc.height);
    if (!rect) return;
    const L = s.layer.ctx;
    const img = L.getImageData(rect.x, rect.y, rect.w, rect.h), d = img.data;
    const src = this.beforeData, sel = this.selData;
    const f = this.from, t = this.to, aa = this.settings.antialias;
    const dr = t.r - f.r, dg = t.g - f.g, db = t.b - f.b;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const ix = rect.x + x, iy = rect.y + y;
        const dist = Math.hypot(ix + 0.5 - p.x, iy + 0.5 - p.y);
        let cov = aa ? clamp(rad - dist + 0.5, 0, 1) : dist <= rad ? 1 : 0;
        if (!cov) continue;
        const si = (iy * W + ix) * 4;
        if (sel) cov *= sel[si + 3] / 255;
        if (!cov || !colorClose(src, si, f.r, f.g, f.b, f.a, this.limit)) continue;
        const o = (y * rect.w + x) * 4;
        d[o] = src[si] + (clamp(src[si] + dr, 0, 255) - src[si]) * cov;
        d[o + 1] = src[si + 1] + (clamp(src[si + 1] + dg, 0, 255) - src[si + 1]) * cov;
        d[o + 2] = src[si + 2] + (clamp(src[si + 2] + db, 0, 255) - src[si + 2]) * cov;
      }
    }
    L.putImageData(img, rect.x, rect.y);
    s.dirty = Rect.union(s.dirty, rect);
    doc.invalidate(rect);
  }
  drawOverlay(ctx, view) { BrushBase.prototype.drawOverlay.call(this, ctx, view); }
  brushWidth() { return this.settings.brushWidth; }
  getCursor() { return toolCursor(iconSvg(this.icon)); }
}
