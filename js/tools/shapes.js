import { Tool, StrokeCompositor, PAINT_BLEND, drawHandle, HANDLE_HIT, toolCursor } from './common.js';
import { Rect, snapAngle } from '../util.js';
import { toCss } from '../color.js';
import { iconSvg } from '../icons.js';

export const SHAPES = [
  ['rectangle', 'Rectangle'], ['roundrect', 'Rounded Rectangle'], ['ellipse', 'Ellipse'], ['diamond', 'Diamond'],
  ['triangle', 'Triangle'], ['righttriangle', 'Right Triangle'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'],
  ['octagon', 'Octagon'], ['star5', '5 Point Star'], ['star6', '6 Point Star'], ['plus', 'Plus'],
  ['arrowright', 'Arrow'], ['heart', 'Heart'], ['callout', 'Callout'],
];

export const DASHES = { solid: [], dash: [3, 1], dot: [1, 1], dashdot: [3, 1, 1, 1], dashdotdot: [3, 1, 1, 1, 1, 1] };

function polygon(p, pts, x, y, w, h) {
  pts.forEach(([u, v], i) => (i ? p.lineTo(x + u * w, y + v * h) : p.moveTo(x + u * w, y + v * h)));
  p.closePath();
}
function regular(n, rot = -Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => [0.5 + 0.5 * Math.cos(rot + (i * 2 * Math.PI) / n), 0.5 + 0.5 * Math.sin(rot + (i * 2 * Math.PI) / n)]);
}
function star(n, inner) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? inner : 0.5;
    return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)];
  });
}

export function shapePath(type, r) {
  const p = new Path2D();
  const { x, y, w, h } = r;
  switch (type) {
    case 'rectangle': p.rect(x, y, w, h); break;
    case 'roundrect': {
      const rad = Math.min(Math.abs(w), Math.abs(h)) * 0.2;
      if (p.roundRect) p.roundRect(x, y, w, h, rad); else p.rect(x, y, w, h);
      break;
    }
    case 'ellipse': p.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); break;
    case 'diamond': polygon(p, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], x, y, w, h); break;
    case 'triangle': polygon(p, [[0.5, 0], [1, 1], [0, 1]], x, y, w, h); break;
    case 'righttriangle': polygon(p, [[0, 0], [1, 1], [0, 1]], x, y, w, h); break;
    case 'pentagon': polygon(p, regular(5), x, y, w, h); break;
    case 'hexagon': polygon(p, regular(6, 0), x, y, w, h); break;
    case 'octagon': polygon(p, regular(8, Math.PI / 8), x, y, w, h); break;
    case 'star5': polygon(p, star(5, 0.2), x, y, w, h); break;
    case 'star6': polygon(p, star(6, 0.27), x, y, w, h); break;
    case 'plus': polygon(p, [[0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67], [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33]], x, y, w, h); break;
    case 'arrowright': polygon(p, [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]], x, y, w, h); break;
    case 'heart': {
      const X = (u) => x + u * w, Y = (v) => y + v * h;
      p.moveTo(X(0.5), Y(0.25));
      p.bezierCurveTo(X(0.5), Y(0.05), X(0.15), Y(-0.05), X(0.03), Y(0.2));
      p.bezierCurveTo(X(-0.08), Y(0.45), X(0.2), Y(0.7), X(0.5), Y(1));
      p.bezierCurveTo(X(0.8), Y(0.7), X(1.08), Y(0.45), X(0.97), Y(0.2));
      p.bezierCurveTo(X(0.85), Y(-0.05), X(0.5), Y(0.05), X(0.5), Y(0.25));
      p.closePath();
      break;
    }
    case 'callout': polygon(p, [[0, 0], [1, 0], [1, 0.75], [0.45, 0.75], [0.2, 1], [0.25, 0.75], [0, 0.75]], x, y, w, h); break;
    default: p.rect(x, y, w, h);
  }
  return p;
}

const H8 = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];

// Base for tools that create an editable item which is committed later.
class EditableTool extends Tool {
  constructor(app, meta) { super(app, meta); this.edit = null; }
  get hasPending() { return !!this.edit; }
  onSettingChanged() { if (this.edit) this.draw(); }
  onColorsChanged() { if (this.edit && !this.edit.swapped) this.draw(); }
  onKeyDown(e) {
    if (!this.edit) return false;
    if (e.key === 'Enter') { this.commit(); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    return false;
  }
  startSession() {
    const s = new StrokeCompositor(this.doc);
    s.direct = true;
    return s;
  }
  compose(rect) {
    const E = this.edit, s = E.s, st = this.settings;
    s.color = E.colors[0];
    s.mode = PAINT_BLEND[st.blendMode] || 'source-over';
    s.antialias = st.antialias;
    const r = Rect.outer(rect);
    s.compose(E.lastRect ? Rect.union(E.lastRect, r) : r);
    E.lastRect = r;
    this.render();
  }
  commit() {
    if (!this.edit) return;
    const E = this.edit;
    this.edit = null;
    E.s.finish(this.name, this.icon);
    this.render();
  }
  cancel() {
    if (!this.edit) return;
    this.edit.s.cancel();
    this.edit = null;
    this.render();
  }
  dashFor(width) { return (DASHES[this.settings.lineStyle] || []).map((d) => d * Math.max(1, width)); }
  getCursor(p) { return this.hitTest(p) ? 'move' : toolCursor(iconSvg(this.icon)); }
}

export class LineCurveTool extends EditableTool {
  constructor(app) {
    super(app, {
      id: 'linecurve', name: 'Line/Curve', icon: 't_linecurve', key: 'O',
      hint: 'Left click to draw with primary color, right click for secondary color. Drag the handles to bend the line into a curve; drag on the line to add control points. Press Enter to finish.',
      options: ['brushWidth', 'lineStyle', 'arrows', 'antialias', 'blendMode'],
    });
  }
  hitTest(p) {
    if (!this.edit) return null;
    const z = this.app.view.zoom;
    const i = this.edit.pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) * z <= HANDLE_HIT);
    return i >= 0 ? { handle: i } : null;
  }
  onPointerDown(e, p) {
    if (!this.doc) return;
    const hit = this.hitTest(p);
    if (hit) { this.drag = hit.handle; return; }
    if (this.edit && this.edit.pts.length < 8 && e.button === 0) {
      // Clicking on the line adds a control point.
      const ctx = this.edit.s.mctx;
      ctx.save();
      ctx.lineWidth = this.settings.brushWidth + 8 / this.app.view.zoom;
      const onLine = ctx.isPointInStroke(this.curvePath(), p.x, p.y);
      ctx.restore();
      if (onLine) {
        const idx = this.insertIndex(p);
        this.edit.pts.splice(idx, 0, { ...p });
        this.drag = idx;
        this.draw();
        return;
      }
    }
    this.commit();
    const swap = e.button === 2;
    const c = swap ? [this.app.secondary, this.app.primary] : [this.app.primary, this.app.secondary];
    this.edit = { s: this.startSession(), pts: [{ ...p }, { ...p }], colors: c, swapped: swap, lastRect: null };
    this.drag = 1;
  }
  insertIndex(p) {
    // Insert between the pair of consecutive points closest to p.
    const pts = this.edit.pts;
    let best = 1, bd = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
      if (d < bd) { bd = d; best = i + 1; }
    }
    return best;
  }
  onPointerMove(e, p) {
    if (this.drag == null || !this.edit) return;
    const pts = this.edit.pts;
    let q = { ...p };
    if (e.shiftKey && pts.length === 2) { const o = pts[1 - this.drag]; q = snapAngle(o.x, o.y, p.x, p.y); }
    pts[this.drag] = q;
    this.draw();
  }
  onPointerUp() {
    this.drag = null;
    if (this.edit && this.edit.pts.length === 2 && Math.hypot(this.edit.pts[0].x - this.edit.pts[1].x, this.edit.pts[0].y - this.edit.pts[1].y) < 0.5) this.cancel();
  }
  curvePath() {
    const pts = this.edit.pts, p = new Path2D();
    p.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) { p.lineTo(pts[1].x, pts[1].y); return p; }
    // Catmull-Rom spline through all points
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      p.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
    }
    return p;
  }
  draw() {
    const E = this.edit, s = E.s, m = s.mctx, st = this.settings;
    const w = st.brushWidth;
    m.clearRect(0, 0, s.mask.width, s.mask.height);
    m.save();
    m.strokeStyle = m.fillStyle = toCss({ ...E.colors[0], a: 255 });
    m.lineWidth = w;
    const dash = this.dashFor(w);
    m.setLineDash(dash);
    m.lineCap = dash.length ? 'butt' : 'round';
    m.lineJoin = 'round';
    m.stroke(this.curvePath());
    m.setLineDash([]);
    const pts = E.pts;
    const arrow = (tip, from) => {
      const a = Math.atan2(tip.y - from.y, tip.x - from.x), L = Math.max(6, w * 3), W = Math.max(4, w * 2);
      m.beginPath();
      m.moveTo(tip.x + Math.cos(a) * w * 0.5, tip.y + Math.sin(a) * w * 0.5);
      m.lineTo(tip.x - Math.cos(a) * L + Math.cos(a + Math.PI / 2) * W, tip.y - Math.sin(a) * L + Math.sin(a + Math.PI / 2) * W);
      m.lineTo(tip.x - Math.cos(a) * L - Math.cos(a + Math.PI / 2) * W, tip.y - Math.sin(a) * L - Math.sin(a + Math.PI / 2) * W);
      m.closePath(); m.fill();
    };
    const ar = st.arrows;
    if (ar === 'start' || ar === 'both') arrow(pts[0], pts[1]);
    if (ar === 'end' || ar === 'both') arrow(pts[pts.length - 1], pts[pts.length - 2]);
    m.restore();
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const pad = w * 4 + 4;
    this.compose({ x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad });
  }
  drawOverlay(ctx, view) {
    if (!this.edit) return;
    for (const q of this.edit.pts) { const s = view.toScreen(q.x, q.y); drawHandle(ctx, s.x, s.y, 8, true); }
  }
}

export class ShapesTool extends EditableTool {
  constructor(app) {
    super(app, {
      id: 'shapes', name: 'Shapes', icon: 't_shapes', key: 'O',
      hint: 'Click and drag to draw a shape. Hold Shift to constrain proportions. Drag the handles to resize, drag inside to move. Press Enter to finish.',
      options: ['shapeType', 'brushWidth', 'shapeDraw', 'lineStyle', 'antialias', 'blendMode'],
    });
  }
  hitTest(p) {
    const E = this.edit;
    if (!E) return null;
    const z = this.app.view.zoom, r = E.rect;
    for (let i = 0; i < 8; i++) {
      const [u, v] = H8[i];
      if (Math.hypot(r.x + u * r.w - p.x, r.y + v * r.h - p.y) * z <= HANDLE_HIT) return { handle: i };
    }
    const n = Rect.fromPoints(r.x, r.y, r.x + r.w, r.y + r.h);
    if (Rect.contains(n, p.x, p.y)) return { move: true };
    return null;
  }
  onPointerDown(e, p) {
    if (!this.doc) return;
    const hit = this.hitTest(p);
    if (hit) { this.drag = { ...hit, start: p, r0: { ...this.edit.rect } }; return; }
    this.commit();
    const swap = e.button === 2;
    const c = swap ? [this.app.secondary, this.app.primary] : [this.app.primary, this.app.secondary];
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    this.edit = { s: this.startSession(), rect: { x: q.x, y: q.y, w: 0, h: 0 }, colors: c, swapped: swap, lastRect: null, type: this.settings.shapeType };
    this.drag = { create: true, start: q };
  }
  onPointerMove(e, p) {
    const d = this.drag, E = this.edit;
    if (!d || !E) return;
    if (d.create) {
      let w = Math.round(p.x) - d.start.x, h = Math.round(p.y) - d.start.y;
      if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      E.rect = { x: d.start.x, y: d.start.y, w, h };
    } else if (d.move) {
      E.rect = { ...d.r0, x: d.r0.x + Math.round(p.x - d.start.x), y: d.r0.y + Math.round(p.y - d.start.y) };
    } else {
      const [u, v] = H8[d.handle], r0 = d.r0;
      let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
      if (u === 0) x0 = Math.round(p.x); if (u === 1) x1 = Math.round(p.x);
      if (v === 0) y0 = Math.round(p.y); if (v === 1) y1 = Math.round(p.y);
      E.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    this.app.emit('selectionsize', { w: Math.abs(E.rect.w), h: Math.abs(E.rect.h) });
    this.draw();
  }
  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (d && d.create && this.edit && (Math.abs(this.edit.rect.w) < 1 || Math.abs(this.edit.rect.h) < 1)) this.cancel();
    this.app.emit('selectionsize', null);
  }
  onSettingChanged(key) {
    if (this.edit && key === 'shapeType') this.edit.type = this.settings.shapeType;
    super.onSettingChanged();
  }
  draw() {
    const E = this.edit, s = E.s, m = s.mctx, st = this.settings;
    const r0 = E.rect;
    const r = Rect.fromPoints(r0.x, r0.y, r0.x + r0.w, r0.y + r0.h);
    const w = st.brushWidth;
    const outline = st.shapeDraw !== 'fill', fill = st.shapeDraw !== 'outline';
    // Outline sits inside the bounds, as in paint.net.
    const ri = outline ? { x: r.x + w / 2, y: r.y + w / 2, w: Math.max(0, r.w - w), h: Math.max(0, r.h - w) } : r;
    const path = shapePath(E.type, ri);
    m.clearRect(0, 0, s.mask.width, s.mask.height);
    m.save();
    if (fill) {
      m.fillStyle = toCss({ ...(outline ? E.colors[1] : E.colors[0]), a: 255 });
      m.fill(path);
    }
    if (outline) {
      m.strokeStyle = toCss({ ...E.colors[0], a: 255 });
      m.lineWidth = w;
      const dash = this.dashFor(w);
      m.setLineDash(dash);
      m.lineJoin = E.type === 'roundrect' || E.type === 'ellipse' ? 'round' : 'miter';
      m.stroke(path);
    }
    m.restore();
    this.compose(Rect.inflate(r, w + 4));
  }
  drawOverlay(ctx, view) {
    if (!this.edit) return;
    const r = this.edit.rect;
    const a = view.toScreen(r.x, r.y), b = view.toScreen(r.x + r.w, r.y + r.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(Math.round(Math.min(a.x, b.x)) + 0.5, Math.round(Math.min(a.y, b.y)) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.setLineDash([]);
    if (this.drag && this.drag.create) return;
    for (const [u, v] of H8) { const s = view.toScreen(r.x + u * r.w, r.y + v * r.h); drawHandle(ctx, s.x, s.y, 7); }
  }
}
