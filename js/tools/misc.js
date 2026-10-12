import { Tool, toolCursor } from './common.js';
import { iconSvg } from '../icons.js';

export class ZoomTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'zoom', name: 'Zoom', icon: 't_zoom', key: 'Z',
      hint: 'Left click to zoom in, right click to zoom out, click and drag to zoom in to a rectangle.',
      options: [],
    });
  }
  onPointerDown(e, p) { this.start = p; this.end = p; this.button = e.button; this.screenStart = { x: e.clientX, y: e.clientY }; }
  onPointerMove(e, p) { if (this.start) this.end = p; }
  onPointerUp(e, p) {
    if (!this.start) return;
    const v = this.app.view;
    const r = v.display.getBoundingClientRect();
    const moved = Math.hypot(e.clientX - this.screenStart.x, e.clientY - this.screenStart.y) > 4;
    if (moved && this.button === 0) {
      const a = this.start, b = this.end;
      v.zoomToRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(1, Math.abs(b.x - a.x)), h: Math.max(1, Math.abs(b.y - a.y)) });
    } else {
      const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (this.button === 2) v.zoomOut(anchor); else v.zoomIn(anchor);
    }
    this.start = null;
  }
  drawOverlay(ctx, view) {
    if (!this.start || this.button !== 0) return;
    const a = view.toScreen(this.start.x, this.start.y), b = view.toScreen(this.end.x, this.end.y);
    const p = new Path2D();
    p.rect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    view.strokeAnts(ctx, p);
  }
  getCursor() { return 'zoom-in'; }
}

export class PanTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'pan', name: 'Pan', icon: 't_pan', key: 'H',
      hint: 'Click and drag to navigate the image.',
      options: [],
    });
  }
  getCursor() { return 'grab'; }
}

export class ColorPickerTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'colorpicker', name: 'Color Picker', icon: 't_colorpicker', key: 'K',
      hint: 'Left click to set primary color. Right click to set secondary color.',
      options: ['pickerSampling', 'pickerSource', 'pickerAfter'],
    });
  }
  sample(p) {
    const doc = this.doc;
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
    const n = this.settings.pickerSampling, half = (n - 1) / 2;
    const src = this.settings.pickerSource === 'image' ? doc.getComposite() : doc.activeLayer.canvas;
    const x0 = Math.max(0, x - half), y0 = Math.max(0, y - half);
    const w = Math.min(doc.width, x + half + 1) - x0, h = Math.min(doc.height, y + half + 1) - y0;
    const d = src.getContext('2d').getImageData(x0, y0, w, h).data;
    let r = 0, g = 0, b = 0, a = 0;
    const cnt = w * h;
    for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; }
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: Math.round(r / a), g: Math.round(g / a), b: Math.round(b / a), a: Math.round(a / cnt) };
  }
  pick(e, p) {
    const c = this.sample(p);
    if (!c) return;
    if (this.button === 2) this.app.setSecondary(c); else this.app.setPrimary(c);
  }
  onPointerDown(e, p) { if (!this.doc) return; this.button = e.button; this.down = true; this.pick(e, p); }
  onPointerMove(e, p) { if (this.down) this.pick(e, p); }
  onPointerUp() {
    if (!this.down) return;
    this.down = false;
    const after = this.settings.pickerAfter;
    if (after === 'previous' && this.app.previousToolId) this.app.setTool(this.app.previousToolId);
    else if (after === 'pencil') this.app.setTool('pencil');
  }
  getCursor() { return toolCursor(iconSvg(this.icon)); }
}
