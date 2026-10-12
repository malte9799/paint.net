import { Tool, selectionMode, floodMask, maskToCanvas, sampleData, toolCursor } from './common.js';
import { selectionItem } from '../selection.js';
import { iconSvg } from '../icons.js';

const MODE_NAMES = { replace: '', union: ' (Union)', exclude: ' (Exclude)', xor: ' (Xor)', intersect: ' (Intersect)' };

function commitSelection(app, name, icon, mode, drawFn) {
  const doc = app.activeDoc;
  const before = doc.selection.snapshot();
  doc.selection.combine(mode, drawFn);
  const after = doc.selection.snapshot();
  doc.history.push(selectionItem(doc, name, icon, before, after));
  doc.emit('selection');
}

class ShapeSelectBase extends Tool {
  onPointerDown(e, p) {
    if (!this.doc) return;
    this.mode = selectionMode(this.app, e);
    this.start = this.snap(p);
    this.end = this.start;
    this.dragging = true;
  }
  snap(p) { return { x: Math.round(Math.max(0, Math.min(this.doc.width, p.x))), y: Math.round(Math.max(0, Math.min(this.doc.height, p.y))) }; }
  onPointerMove(e, p) {
    if (!this.dragging) return;
    let q = { x: Math.round(p.x), y: Math.round(p.y) };
    if (e.shiftKey) {
      const d = Math.max(Math.abs(q.x - this.start.x), Math.abs(q.y - this.start.y));
      q = { x: this.start.x + Math.sign(q.x - this.start.x || 1) * d, y: this.start.y + Math.sign(q.y - this.start.y || 1) * d };
    }
    this.end = q;
    this.app.emit('selectionsize', this.rect);
  }
  get rect() {
    const a = this.start, b = this.end;
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }
  onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    const r = this.rect;
    if (r.w < 1 || r.h < 1) {
      if (this.mode === 'replace' && !this.doc.selection.empty) this.app.run('edit.deselect');
      return;
    }
    commitSelection(this.app, this.name + MODE_NAMES[this.mode], this.icon, this.mode, (c) => this.fillShape(c, r));
    this.app.emit('selectionsize', null);
  }
  get hidesSelection() { return this.dragging && this.mode === 'replace'; }
  drawOverlay(ctx, view) {
    if (!this.dragging) return;
    const r = this.rect;
    const a = view.toScreen(r.x, r.y);
    const p = new Path2D();
    this.screenShape(p, Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, r.w * view.zoom, r.h * view.zoom);
    ctx.fillStyle = 'rgba(0,120,215,0.12)';
    ctx.fill(p);
    view.strokeAnts(ctx, p);
  }
  getCursor() { return toolCursor(iconSvg(this.icon)); }
}

export class RectSelectTool extends ShapeSelectBase {
  constructor(app) {
    super(app, {
      id: 'rectselect', name: 'Rectangle Select', icon: 't_rectselect', key: 'S',
      hint: 'Click and drag to draw a rectangular selection. Hold Shift to constrain to a square.',
      options: ['selectionMode'],
    });
  }
  fillShape(c, r) { c.fillRect(r.x, r.y, r.w, r.h); }
  screenShape(p, x, y, w, h) { p.rect(x, y, w, h); }
}

export class EllipseSelectTool extends ShapeSelectBase {
  constructor(app) {
    super(app, {
      id: 'ellipseselect', name: 'Ellipse Select', icon: 't_ellipseselect', key: 'S',
      hint: 'Click and drag to draw an elliptical selection. Hold Shift to constrain to a circle.',
      options: ['selectionMode'],
    });
  }
  fillShape(c, r) { c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); c.fill(); }
  screenShape(p, x, y, w, h) { p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); }
}

export class LassoSelectTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'lasso', name: 'Lasso Select', icon: 't_lasso', key: 'S',
      hint: 'Click and drag to draw the outline for a selection area.',
      options: ['selectionMode'],
    });
  }
  onPointerDown(e, p) {
    if (!this.doc) return;
    this.mode = selectionMode(this.app, e);
    this.points = [p];
  }
  onPointerMove(e, p) {
    if (!this.points) return;
    const l = this.points[this.points.length - 1];
    if (Math.hypot(l.x - p.x, l.y - p.y) >= 0.5) this.points.push(p);
  }
  onPointerUp() {
    const pts = this.points;
    this.points = null;
    if (!pts) return;
    if (pts.length < 3) {
      if (this.mode === 'replace' && !this.doc.selection.empty) this.app.run('edit.deselect');
      return;
    }
    commitSelection(this.app, 'Lasso Select' + MODE_NAMES[this.mode], this.icon, this.mode, (c) => {
      c.beginPath();
      pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.closePath();
      c.fill();
    });
  }
  get hidesSelection() { return !!this.points && this.mode === 'replace'; }
  drawOverlay(ctx, view) {
    if (!this.points) return;
    const p = new Path2D();
    this.points.forEach((q, i) => { const s = view.toScreen(q.x, q.y); i ? p.lineTo(s.x, s.y) : p.moveTo(s.x, s.y); });
    p.closePath();
    ctx.fillStyle = 'rgba(0,120,215,0.12)';
    ctx.fill(p);
    view.strokeAnts(ctx, p);
  }
  getCursor() { return toolCursor(iconSvg(this.icon)); }
}

export class MagicWandTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'magicwand', name: 'Magic Wand', icon: 't_magicwand', key: 'S',
      hint: 'Click to select an area of similar color.',
      options: ['selectionMode', 'floodMode', 'tolerance', 'sampling'],
    });
  }
  onPointerDown(e, p) {
    const doc = this.doc;
    if (!doc || p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
    const mode = selectionMode(this.app, e);
    const data = sampleData(doc, this.settings.sampling);
    const global = this.settings.floodMode === 'global' || e.shiftKey;
    const mask = floodMask(data, doc.width, doc.height, p.x, p.y, this.settings.tolerance, global);
    const mc = maskToCanvas(mask, doc.width, doc.height);
    commitSelection(this.app, 'Magic Wand Select' + MODE_NAMES[mode], this.icon, mode, (c) => c.drawImage(mc, 0, 0));
  }
  getCursor() { return toolCursor(iconSvg(this.icon)); }
}
