import { Tool, StrokeCompositor, PAINT_BLEND, floodMask, maskToCanvas, maskBounds, sampleData, drawHandle, HANDLE_HIT, toolCursor } from './common.js';
import { snapAngle, clamp } from '../util.js';
import { iconSvg } from '../icons.js';

export class PaintBucketTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'paintbucket', name: 'Paint Bucket', icon: 't_paintbucket', key: 'F',
      hint: 'Left click to fill a region with the primary color, right click to fill with the secondary color.',
      options: ['floodMode', 'tolerance', 'sampling', 'antialias', 'blendMode'],
    });
  }
  onPointerDown(e, p) {
    const doc = this.doc;
    if (!doc || p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
    if (!doc.selection.contains(p.x, p.y)) return;
    const data = sampleData(doc, this.settings.sampling);
    const global = this.settings.floodMode === 'global' || e.shiftKey;
    const mask = floodMask(data, doc.width, doc.height, p.x, p.y, this.settings.tolerance, global);
    const b = maskBounds(mask, doc.width, doc.height);
    if (!b) return;
    const s = new StrokeCompositor(doc);
    s.color = e.button === 2 ? this.app.secondary : this.app.primary;
    s.mode = PAINT_BLEND[this.settings.blendMode] || 'source-over';
    s.mctx.drawImage(maskToCanvas(mask, doc.width, doc.height), 0, 0);
    if (this.settings.antialias) {
      // Soften the hard flood edge slightly, as paint.net's antialiased fill does.
      const m2 = s.mask.getContext('2d');
      m2.save();
      m2.filter = 'blur(0.6px)';
      m2.globalCompositeOperation = 'source-over';
      m2.drawImage(s.mask, 0, 0);
      m2.restore();
    }
    s.compose(b);
    s.finish('Paint Bucket', this.icon);
  }
  getCursor() { return toolCursor(iconSvg(this.icon)); }
}

const GRADIENT_FN = {
  linear: (u) => u,
  reflected: (u) => Math.abs(u),
  diamond: (u, v) => Math.abs(u) + Math.abs(v),
  radial: (u, v) => Math.hypot(u, v),
  conical: (u, v) => Math.abs(Math.atan2(v, u)) / Math.PI,
  spiralcw: (u, v) => { const t = Math.atan2(v, u) / (2 * Math.PI) + Math.hypot(u, v); return t - Math.floor(t); },
  spiralccw: (u, v) => { const t = -Math.atan2(v, u) / (2 * Math.PI) + Math.hypot(u, v); return t - Math.floor(t); },
};

export class GradientTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'gradient', name: 'Gradient', icon: 't_gradient', key: 'G',
      hint: 'Click and drag to draw a gradient. Left click uses primary to secondary, right click reverses. Drag the handles to adjust; press Enter to finish.',
      options: ['gradientType', 'gradientMode', 'blendMode'],
    });
    this.edit = null;
  }
  get hasPending() { return !!this.edit; }
  hitHandle(p) {
    if (!this.edit) return null;
    const z = this.app.view.zoom;
    for (const k of ['p1', 'p0']) {
      const q = this.edit[k];
      if (Math.hypot(q.x - p.x, q.y - p.y) * z <= HANDLE_HIT) return k;
    }
    return null;
  }
  onPointerDown(e, p) {
    const doc = this.doc;
    if (!doc) return;
    const h = this.hitHandle(p);
    if (h) { this.drag = h; return; }
    this.commit();
    const s = new StrokeCompositor(doc);
    const rect = doc.editBounds;
    this.edit = {
      s, rect, p0: { ...p }, p1: { ...p }, reversed: e.button === 2,
      before: s.before.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h),
      sel: doc.selection.empty ? null : doc.selection.ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data,
    };
    this.drag = 'p1';
  }
  onPointerMove(e, p) {
    if (!this.drag || !this.edit) return;
    const other = this.edit[this.drag === 'p1' ? 'p0' : 'p1'];
    this.edit[this.drag] = e.shiftKey ? snapAngle(other.x, other.y, p.x, p.y) : { ...p };
    this.renderGradient();
  }
  onPointerUp() {
    this.drag = null;
    if (this.edit && this.edit.p0.x === this.edit.p1.x && this.edit.p0.y === this.edit.p1.y) { this.edit.s.cancel(); this.edit = null; }
  }
  onSettingChanged() { if (this.edit) this.renderGradient(); }
  onColorsChanged() { if (this.edit) this.renderGradient(); }
  onKeyDown(e) {
    if (!this.edit) return false;
    if (e.key === 'Enter') { this.commit(); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    return false;
  }
  renderGradient() {
    const E = this.edit, doc = this.doc, r = E.rect;
    const { p0, p1 } = E;
    const dx = p1.x - p0.x, dy = p1.y - p0.y, len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return;
    const len = Math.sqrt(len2);
    const ux = dx / len, uy = dy / len;
    const fn = GRADIENT_FN[this.settings.gradientType] || GRADIENT_FN.linear;
    let c0 = this.app.primary, c1 = this.app.secondary;
    if (E.reversed) [c0, c1] = [c1, c0];
    const transparency = this.settings.gradientMode === 'transparency';
    const overwrite = this.settings.blendMode === 'overwrite';
    const src = E.before.data, sel = E.sel;
    const out = new ImageData(r.w, r.h), d = out.data;
    for (let y = 0; y < r.h; y++) {
      const py = r.y + y + 0.5 - p0.y;
      for (let x = 0; x < r.w; x++) {
        const px = r.x + x + 0.5 - p0.x;
        const u = (px * ux + py * uy) / len, v = (-px * uy + py * ux) / len;
        const t = clamp(fn(u, v), 0, 1);
        const i = (y * r.w + x) * 4;
        const br = src[i], bg = src[i + 1], bb = src[i + 2], ba = src[i + 3];
        let or, og, ob, oa;
        if (transparency) {
          const fa = E.reversed ? t : 1 - t;
          or = br; og = bg; ob = bb; oa = ba * fa;
        } else {
          const ga = (c0.a + (c1.a - c0.a) * t) / 255;
          const gr = c0.r + (c1.r - c0.r) * t, gg = c0.g + (c1.g - c0.g) * t, gb = c0.b + (c1.b - c0.b) * t;
          if (overwrite) { or = gr; og = gg; ob = gb; oa = ga * 255; } else {
            const a0 = ba / 255, ao = ga + a0 * (1 - ga);
            if (ao <= 0) { or = og = ob = oa = 0; } else {
              or = (gr * ga + br * a0 * (1 - ga)) / ao;
              og = (gg * ga + bg * a0 * (1 - ga)) / ao;
              ob = (gb * ga + bb * a0 * (1 - ga)) / ao;
              oa = ao * 255;
            }
          }
        }
        if (sel) {
          const m = sel[i + 3] / 255;
          or = br + (or - br) * m; og = bg + (og - bg) * m; ob = bb + (ob - bb) * m; oa = ba + (oa - ba) * m;
        }
        d[i] = or; d[i + 1] = og; d[i + 2] = ob; d[i + 3] = oa;
      }
    }
    E.s.layer.ctx.putImageData(out, r.x, r.y);
    E.s.dirty = { ...r };
    doc.invalidate(r);
  }
  commit() {
    if (!this.edit) return;
    this.edit.s.finish('Gradient', this.icon);
    this.edit = null;
    this.drag = null;
    this.render();
  }
  cancel() {
    if (!this.edit) return;
    this.edit.s.cancel();
    this.edit = null;
    this.render();
  }
  drawOverlay(ctx, view) {
    if (!this.edit) return;
    const a = view.toScreen(this.edit.p0.x, this.edit.p0.y), b = view.toScreen(this.edit.p1.x, this.edit.p1.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    drawHandle(ctx, a.x, a.y, 9, true);
    drawHandle(ctx, b.x, b.y, 9, true);
  }
  getCursor(p) { return this.hitHandle(p) ? 'move' : toolCursor(iconSvg(this.icon)); }
}
