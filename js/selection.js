import { createCanvas, Rect } from './util.js';

// The selection is stored as an 8-bit alpha mask the size of the image.
// An empty selection means "everything" for editing purposes (as in paint.net).
export class Selection {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.mask = createCanvas(w, h);
    this.empty = true;
    this.bounds = null;
    this.outline = null; // Path2D in image coordinates
    this.version = 0;
    this._inside = null;
  }
  get ctx() { return this.mask.getContext('2d', { willReadFrequently: true }); }

  resize(w, h) {
    this.w = w; this.h = h;
    this.mask = createCanvas(w, h);
    this.empty = true; this.bounds = null; this.outline = null; this._inside = null;
    this.version++;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this._update();
  }

  selectAll() {
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, this.w, this.h);
    this._update();
  }

  // drawFn(ctx) must fill the shape with opaque white.
  combine(mode, drawFn) {
    const c = this.ctx;
    c.save();
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    if (this.empty && (mode === 'union' || mode === 'xor')) mode = 'replace';
    switch (mode) {
      case 'replace':
        c.clearRect(0, 0, this.w, this.h);
        drawFn(c);
        break;
      case 'union':
        drawFn(c);
        break;
      case 'exclude':
        c.globalCompositeOperation = 'destination-out';
        drawFn(c);
        break;
      case 'xor':
        c.globalCompositeOperation = 'xor';
        drawFn(c);
        break;
      case 'intersect': {
        const t = createCanvas(this.w, this.h), tc = t.getContext('2d');
        tc.fillStyle = '#fff'; tc.strokeStyle = '#fff';
        drawFn(tc);
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(t, 0, 0);
        break;
      }
    }
    c.restore();
    this._update();
  }

  invert() {
    const c = this.ctx;
    if (this.empty) { this.selectAll(); return; }
    c.save();
    c.globalCompositeOperation = 'xor';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, this.w, this.h);
    c.restore();
    this._update();
  }

  // Replace the mask with a canvas (same size) or draw a transformed mask.
  setFromCanvas(canvas, matrix) {
    const c = this.ctx;
    c.save();
    c.clearRect(0, 0, this.w, this.h);
    if (matrix) c.setTransform(matrix);
    c.imageSmoothingEnabled = true;
    c.drawImage(canvas, 0, 0);
    c.restore();
    this._update();
  }

  setRect(r) { this.combine('replace', (c) => c.fillRect(r.x, r.y, r.w, r.h)); }

  // Clip mask for painting, or null when the whole image is editable.
  get clip() { return this.empty ? null : this.mask; }

  contains(x, y) {
    if (this.empty) return true;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !this._inside) return false;
    return this._inside[y * this.w + x] === 1;
  }

  snapshot() {
    if (this.empty) return { empty: true };
    const b = this.bounds;
    const c = createCanvas(b.w, b.h);
    c.getContext('2d').drawImage(this.mask, -b.x, -b.y);
    return { empty: false, bounds: { ...b }, canvas: c };
  }

  restore(s) {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    if (!s.empty) c.drawImage(s.canvas, s.bounds.x, s.bounds.y);
    this._update();
  }

  // Cropped copy of the mask for a rect, as a canvas.
  maskFor(rect) {
    const c = createCanvas(rect.w, rect.h);
    c.getContext('2d').drawImage(this.mask, -rect.x, -rect.y);
    return c;
  }

  // Recompute bounds and the pixel-edge outline (for marching ants).
  _update() {
    this.version++;
    const w = this.w, h = this.h;
    const data = this.ctx.getImageData(0, 0, w, h).data;
    const inside = new Uint8Array(w * h);
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0, i = 3, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4, p++) {
        if (data[i] >= 128) {
          inside[p] = 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) {
      // Anything below the threshold is dropped so `empty` really means empty.
      this.ctx.clearRect(0, 0, w, h);
      this.empty = true; this.bounds = null; this.outline = null; this._inside = null;
      return;
    }
    this.empty = false;
    this._inside = inside;
    this.bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    this.outline = traceOutline(inside, w, h, this.bounds);
  }
}

// Builds a path consisting of merged pixel-edge segments between selected and unselected pixels.
export function traceOutline(inside, w, h, b) {
  const p = new Path2D();
  const x0 = Math.max(0, b.x - 1), x1 = Math.min(w, b.x + b.w + 1);
  const y0 = Math.max(0, b.y - 1), y1 = Math.min(h, b.y + b.h + 1);
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? inside[y * w + x] : 0);
  // Horizontal edges
  for (let y = y0; y <= y1; y++) {
    let start = -1;
    for (let x = x0; x <= x1; x++) {
      const edge = x < x1 && at(x, y - 1) !== at(x, y);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) { p.moveTo(start, y); p.lineTo(x, y); start = -1; }
    }
  }
  // Vertical edges
  for (let x = x0; x <= x1; x++) {
    let start = -1;
    for (let y = y0; y <= y1; y++) {
      const edge = y < y1 && at(x - 1, y) !== at(x, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) { p.moveTo(x, start); p.lineTo(x, y); start = -1; }
    }
  }
  return p;
}

// Selection snapshot → undo item helper
export function selectionItem(doc, name, icon, before, after) {
  return {
    name, icon,
    undo: () => { doc.selection.restore(before); doc.emit('selection'); },
    redo: () => { doc.selection.restore(after); doc.emit('selection'); },
  };
}

export { Rect };
