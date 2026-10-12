import { Tool, drawHandle, HANDLE_HIT, toolCursor } from './common.js';
import { createCanvas, cloneCanvas, Rect } from '../util.js';
import { pixelItem } from '../history.js';
import { iconSvg } from '../icons.js';

const HANDLES = [
  [0, 0, 'nwse-resize'], [0.5, 0, 'ns-resize'], [1, 0, 'nesw-resize'], [1, 0.5, 'ew-resize'],
  [1, 1, 'nwse-resize'], [0.5, 1, 'ns-resize'], [0, 1, 'nesw-resize'], [0, 0.5, 'ew-resize'],
];

function matrixOf(R, T) {
  const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
  return new DOMMatrix().translate(cx + T.tx, cy + T.ty).rotate(T.angle).scale(T.sx, T.sy).translate(-cx, -cy);
}

function boundsOf(R, M) {
  const pts = [[R.x, R.y], [R.x + R.w, R.y], [R.x, R.y + R.h], [R.x + R.w, R.y + R.h]].map(([x, y]) => M.transformPoint({ x, y }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.floor(Math.min(...xs)) - 1, y = Math.floor(Math.min(...ys)) - 1;
  return { x, y, w: Math.ceil(Math.max(...xs)) + 1 - x, h: Math.ceil(Math.max(...ys)) + 1 - y };
}

// Shared transform interaction: translate (left drag), scale (handles), rotate (right drag).
class TransformTool extends Tool {
  constructor(app, meta) { super(app, meta); this.sess = null; this.drag = null; }

  get matrix() { return this.sess ? matrixOf(this.sess.R, this.sess.T) : null; }
  get selectionMatrix() {
    if (!this.drag || !this.sess) return null;
    return this.matrix.multiply(this.drag.M0.inverse());
  }
  sessionValid() {
    const s = this.sess;
    return s && s.doc === this.doc && s.item === this.doc.history.top && s.layer === this.doc.activeLayer;
  }
  hitHandle(p) {
    if (!this.sessionValid() && !(this.doc && !this.doc.selection.empty)) return null;
    const R = this.sessionValid() ? this.sess.R : this.doc.selection.bounds;
    const M = this.sessionValid() ? this.matrix : new DOMMatrix();
    const z = this.app.view.zoom;
    for (let i = 0; i < HANDLES.length; i++) {
      const [hx, hy] = HANDLES[i];
      const q = M.transformPoint({ x: R.x + hx * R.w, y: R.y + hy * R.h });
      if (Math.hypot(q.x - p.x, q.y - p.y) * z <= HANDLE_HIT) return i;
    }
    return null;
  }
  onPointerDown(e, p) {
    const doc = this.doc;
    if (!doc) return;
    const handle = e.button === 0 ? this.hitHandle(p) : null;
    if (!this.sessionValid()) this.sess = this.lift(e);
    if (!this.sess) return;
    const s = this.sess;
    const M0 = this.matrix;
    this.drag = { start: p, T0: { ...s.T }, M0, handle, rotate: e.button === 2, beforeDrag: this.beginDrag() };
    if (handle != null) {
      const [hx, hy] = HANDLES[handle];
      const aLocal = { x: s.R.x + (1 - hx) * s.R.w, y: s.R.y + (1 - hy) * s.R.h };
      this.drag.aLocal = aLocal;
      this.drag.aWorld = M0.transformPoint(aLocal);
    }
  }
  onPointerMove(e, p) {
    const d = this.drag;
    if (!d) return;
    const s = this.sess, R = s.R, T = s.T, T0 = d.T0;
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    if (d.rotate) {
      const cw = { x: cx + T0.tx, y: cy + T0.ty };
      let a = T0.angle + ((Math.atan2(p.y - cw.y, p.x - cw.x) - Math.atan2(d.start.y - cw.y, d.start.x - cw.x)) * 180) / Math.PI;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      T.angle = a;
    } else if (d.handle != null) {
      const [hx, hy] = HANDLES[d.handle];
      const rad = (-T.angle * Math.PI) / 180;
      const vx0 = p.x - d.aWorld.x, vy0 = p.y - d.aWorld.y;
      const vx = vx0 * Math.cos(rad) - vy0 * Math.sin(rad), vy = vx0 * Math.sin(rad) + vy0 * Math.cos(rad);
      const dxo = (2 * hx - 1) * R.w, dyo = (2 * hy - 1) * R.h;
      const minS = 1 / Math.max(R.w, R.h);
      const fix = (v) => (Math.abs(v) < minS ? (v < 0 ? -minS : minS) : v);
      let sx = dxo ? fix(vx / dxo) : T0.sx, sy = dyo ? fix(vy / dyo) : T0.sy;
      if (e.shiftKey && dxo && dyo) { const m = (Math.abs(sx) + Math.abs(sy)) / 2; sx = Math.sign(sx) * m; sy = Math.sign(sy) * m; }
      T.sx = sx; T.sy = sy;
      // Keep the anchor fixed
      const r = (T.angle * Math.PI) / 180;
      const lx = (d.aLocal.x - cx) * sx, ly = (d.aLocal.y - cy) * sy;
      T.tx = d.aWorld.x - cx - (lx * Math.cos(r) - ly * Math.sin(r));
      T.ty = d.aWorld.y - cy - (lx * Math.sin(r) + ly * Math.cos(r));
    } else {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      T.tx = T0.tx + Math.round(dx); T.ty = T0.ty + Math.round(dy);
    }
    this.update();
    this.app.emit('selectionsize', boundsOf(R, this.matrix));
  }
  onPointerUp() {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    const T = this.sess.T, T0 = d.T0;
    if (T.tx === T0.tx && T.ty === T0.ty && T.angle === T0.angle && T.sx === T0.sx && T.sy === T0.sy) { this.render(); return; }
    this.endDrag(d);
    this.app.emit('selectionsize', null);
  }
  onKeyDown(e) {
    if (e.key === 'Enter' && this.sess) { this.commit(); this.render(); return true; }
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k || !this.doc || (this.doc.selection.empty && this.id === 'moveselection')) return false;
    const step = e.shiftKey ? 10 : 1;
    const ev = { button: 0, ctrlKey: false, shiftKey: false };
    this.onPointerDown(ev, { x: -1e6, y: -1e6 });
    if (!this.drag) return true;
    this.drag.handle = null;
    this.onPointerMove(ev, { x: -1e6 + k[0] * step, y: -1e6 + k[1] * step });
    this.onPointerUp(ev);
    return true;
  }
  drawOverlay(ctx, view) {
    const doc = this.doc;
    if (!doc || doc.selection.empty) return;
    let R, M;
    if (this.sessionValid()) { R = this.sess.R; M = this.matrix; } else { R = doc.selection.bounds; M = new DOMMatrix(); }
    const S = view.screenMatrix.multiply(M);
    const pts = HANDLES.map(([hx, hy]) => S.transformPoint({ x: R.x + hx * R.w, y: R.y + hy * R.h }));
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    [0, 2, 4, 6].forEach((i, k) => (k ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y)));
    ctx.closePath();
    ctx.stroke();
    for (const q of pts) drawHandle(ctx, q.x, q.y, 7);
  }
  getCursor(p) {
    const h = this.hitHandle(p);
    if (h != null) {
      const ang = this.sessionValid() ? this.sess.T.angle : 0;
      if (Math.abs(ang % 90) < 1) return HANDLES[h][2];
      return 'move';
    }
    return toolCursor(iconSvg(this.icon), 'move');
  }
  deactivate() { this.drag = null; this.sess = null; }
  commit() { this.sess = null; }
}

export class MoveSelectedTool extends TransformTool {
  constructor(app) {
    super(app, {
      id: 'moveselected', name: 'Move Selected Pixels', icon: 't_moveselected', key: 'M',
      hint: 'Drag the selection to move. Drag the handles to scale. Drag with right mouse button to rotate. Hold Ctrl while starting to leave a copy behind.',
      options: ['moveQuality'],
    });
  }
  lift(e) {
    const doc = this.doc, layer = doc.activeLayer;
    const R = doc.selection.empty ? { x: 0, y: 0, w: doc.width, h: doc.height } : { ...doc.selection.bounds };
    const maskSnap = createCanvas(R.w, R.h);
    const mc = maskSnap.getContext('2d');
    if (doc.selection.empty) { mc.fillStyle = '#fff'; mc.fillRect(0, 0, R.w, R.h); } else mc.drawImage(doc.selection.mask, -R.x, -R.y);
    const pixels = createCanvas(R.w, R.h), pc = pixels.getContext('2d');
    pc.drawImage(layer.canvas, -R.x, -R.y);
    pc.globalCompositeOperation = 'destination-in';
    pc.drawImage(maskSnap, 0, 0);
    const base = cloneCanvas(layer.canvas);
    if (!(e.ctrlKey || e.metaKey)) {
      const bc = base.getContext('2d');
      bc.globalCompositeOperation = 'destination-out';
      bc.drawImage(maskSnap, R.x, R.y);
    }
    return { doc, layer, R, maskSnap, pixels, base, T: { tx: 0, ty: 0, angle: 0, sx: 1, sy: 1 }, item: null, wasEmpty: doc.selection.empty };
  }
  // Start a paste: floats `canvas` at (x, y) over the current layer.
  beginPaste(canvas, x, y) {
    const doc = this.doc, layer = doc.activeLayer;
    const R = { x, y, w: canvas.width, h: canvas.height };
    const maskSnap = createCanvas(R.w, R.h), mc = maskSnap.getContext('2d');
    mc.fillStyle = '#fff'; mc.fillRect(0, 0, R.w, R.h);
    const selBefore = doc.selection.snapshot();
    const layerBefore = cloneCanvas(layer.canvas);
    this.sess = { doc, layer, R, maskSnap, pixels: canvas, base: cloneCanvas(layer.canvas), T: { tx: 0, ty: 0, angle: 0, sx: 1, sy: 1 }, item: null };
    this.update();
    doc.selection.setRect(R);
    const rect = Rect.clip(R, doc.width, doc.height) || { x: 0, y: 0, w: 1, h: 1 };
    this.pushItem('Paste', 'paste', layerBefore, rect, selBefore);
    doc.emit('selection');
  }
  beginDrag() { return { layer: cloneCanvas(this.sess.layer.canvas), sel: this.doc.selection.snapshot(), bounds: boundsOf(this.sess.R, this.matrix) }; }
  update() {
    const s = this.sess, L = s.layer.ctx;
    L.save();
    L.clearRect(0, 0, s.layer.width, s.layer.height);
    L.drawImage(s.base, 0, 0);
    L.setTransform(this.matrix.translate(s.R.x, s.R.y));
    L.imageSmoothingEnabled = this.settings.moveQuality !== 'nearest';
    L.imageSmoothingQuality = 'high';
    L.drawImage(s.pixels, 0, 0);
    L.restore();
    s.doc.invalidate();
  }
  endDrag(d) {
    const s = this.sess, doc = this.doc;
    const M = this.matrix;
    doc.selection.setFromCanvas(s.maskSnap, M.translate(s.R.x, s.R.y));
    const rect = Rect.clip(Rect.union(Rect.union(d.beforeDrag.bounds, boundsOf(s.R, M)), s.R), doc.width, doc.height);
    if (rect) this.pushItem('Move Selected Pixels', 't_moveselected', d.beforeDrag.layer, rect, d.beforeDrag.sel);
    doc.emit('selection');
  }
  pushItem(name, icon, layerBefore, rect, selBefore) {
    const doc = this.doc, s = this.sess;
    const selAfter = doc.selection.snapshot();
    const item = pixelItem(doc, s.layer, rect, layerBefore, name, icon, {
      undo: () => { doc.selection.restore(selBefore); this.sess = null; doc.emit('selection'); },
      redo: () => { doc.selection.restore(selAfter); this.sess = null; doc.emit('selection'); },
    });
    doc.history.push(item);
    s.item = item;
  }
  commit() { this.sess = null; }
}

export class MoveSelectionTool extends TransformTool {
  constructor(app) {
    super(app, {
      id: 'moveselection', name: 'Move Selection', icon: 't_moveselection', key: 'M',
      hint: 'Drag the selection outline to move it. Drag the handles to scale. Drag with right mouse button to rotate.',
      options: [],
    });
  }
  lift() {
    const doc = this.doc;
    if (doc.selection.empty) return null;
    const R = { ...doc.selection.bounds };
    return { doc, layer: doc.activeLayer, R, maskSnap: doc.selection.maskFor(R), T: { tx: 0, ty: 0, angle: 0, sx: 1, sy: 1 }, item: null };
  }
  beginDrag() { return { sel: this.doc.selection.snapshot() }; }
  update() { this.render(); }
  endDrag(d) {
    const s = this.sess, doc = this.doc;
    doc.selection.setFromCanvas(s.maskSnap, this.matrix.translate(s.R.x, s.R.y));
    const before = d.sel, after = doc.selection.snapshot();
    const item = {
      name: 'Move Selection', icon: 't_moveselection',
      undo: () => { doc.selection.restore(before); this.sess = null; doc.emit('selection'); },
      redo: () => { doc.selection.restore(after); this.sess = null; doc.emit('selection'); },
    };
    doc.history.push(item);
    s.item = item;
    doc.emit('selection');
  }
}
