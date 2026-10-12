import { h } from './ui/dom.js';
import { clamp, createCanvas } from './util.js';
import { Settings } from './storage.js';
import { openDialogCount } from './ui/dialog.js';

export const ZOOM_LEVELS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.16, 0.2, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24, 32, 40, 48, 56, 64];
const PAD = 24;

export class CanvasView {
  constructor(app, host) {
    this.app = app;
    this.doc = null;
    this.zoom = 1;
    this.dpr = window.devicePixelRatio || 1;
    this.antsPhase = 0;
    this.hover = null; // image coords under the pointer
    this.spaceDown = false;
    this.rulerH = h('canvas.ruler.ruler-h');
    this.rulerV = h('canvas.ruler.ruler-v');
    this.corner = h('div.ruler-corner');
    this.spacer = h('div.spacer');
    this.scroller = h('div.scroller', this.spacer);
    this.display = h('canvas.display', { tabindex: 0 });
    this.viewport = h('div.viewport', this.scroller, this.display);
    this.el = h('div.canvas-area', this.corner, this.rulerH, this.rulerV, this.viewport);
    host.appendChild(this.el);
    this.ctx = this.display.getContext('2d');
    this._checker = null;
    this._renderQueued = false;

    new ResizeObserver(() => this.layout()).observe(this.viewport);
    this.scroller.addEventListener('scroll', () => { this._saveViewState(); this.requestRender(); app.emit('view'); });
    this._bindInput();
    this.setRulers(Settings.get('rulers', false));
    setInterval(() => {
      if (this.doc && !this.doc.selection.empty && !document.hidden) { this.antsPhase = (this.antsPhase + 1) % 8; this.requestRender(); }
    }, 90);
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.requestRender());
  }

  // ---------- geometry ----------
  get viewW() { return this.scroller.clientWidth; }
  get viewH() { return this.scroller.clientHeight; }
  get contentW() { return this.doc ? this.doc.width * this.zoom : 0; }
  get contentH() { return this.doc ? this.doc.height * this.zoom : 0; }
  get origin() {
    const vw = this.viewW, vh = this.viewH, cw = this.contentW, ch = this.contentH;
    const ox = cw + 2 * PAD > vw ? PAD - this.scroller.scrollLeft : (vw - cw) / 2;
    const oy = ch + 2 * PAD > vh ? PAD - this.scroller.scrollTop : (vh - ch) / 2;
    return { ox: Math.round(ox), oy: Math.round(oy) };
  }
  toImage(clientX, clientY) {
    const r = this.display.getBoundingClientRect();
    const { ox, oy } = this.origin;
    return { x: (clientX - r.left - ox) / this.zoom, y: (clientY - r.top - oy) / this.zoom };
  }
  toScreen(x, y) {
    const { ox, oy } = this.origin;
    return { x: ox + x * this.zoom, y: oy + y * this.zoom };
  }
  get screenMatrix() {
    const { ox, oy } = this.origin;
    return new DOMMatrix([this.zoom, 0, 0, this.zoom, ox, oy]);
  }

  layout() {
    const vw = this.viewW, vh = this.viewH;
    this.dpr = window.devicePixelRatio || 1;
    this.display.style.width = vw + 'px';
    this.display.style.height = vh + 'px';
    this.display.width = Math.max(1, Math.round(vw * this.dpr));
    this.display.height = Math.max(1, Math.round(vh * this.dpr));
    this._updateSpacer();
    if (this.rulers) {
      const s = 18;
      this.rulerH.width = Math.round(vw * this.dpr); this.rulerH.height = s * this.dpr;
      this.rulerV.width = s * this.dpr; this.rulerV.height = Math.round(vh * this.dpr);
      this.rulerH.style.width = vw + 'px'; this.rulerV.style.height = vh + 'px';
    }
    this.render();
  }

  _updateSpacer() {
    const cw = this.contentW, ch = this.contentH, vw = this.viewW, vh = this.viewH;
    this.spacer.style.width = (cw + 2 * PAD > vw ? Math.ceil(cw + 2 * PAD) : 1) + 'px';
    this.spacer.style.height = (ch + 2 * PAD > vh ? Math.ceil(ch + 2 * PAD) : 1) + 'px';
  }

  setRulers(on) {
    this.rulers = on;
    this.el.classList.toggle('with-rulers', on);
    requestAnimationFrame(() => this.layout());
  }

  // ---------- document ----------
  setDocument(doc) {
    if (this.doc === doc) return;
    this._saveViewState();
    this.doc = doc;
    if (!doc) { this._updateSpacer(); this.render(); return; }
    if (doc.view) {
      this.zoom = doc.view.zoom;
      this._updateSpacer();
      this.scroller.scrollLeft = doc.view.sl;
      this.scroller.scrollTop = doc.view.st;
    } else {
      this.zoomToFit(true);
    }
    this.render();
    this.app.emit('view');
  }
  _saveViewState() {
    if (this.doc) this.doc.view = { zoom: this.zoom, sl: this.scroller.scrollLeft, st: this.scroller.scrollTop };
  }

  // ---------- zoom ----------
  setZoom(z, anchor) {
    if (!this.doc) return;
    z = clamp(z, 0.01, 64);
    const vw = this.viewW, vh = this.viewH;
    const a = anchor || { x: vw / 2, y: vh / 2 };
    const { ox, oy } = this.origin;
    const px = (a.x - ox) / this.zoom, py = (a.y - oy) / this.zoom;
    this.zoom = z;
    this._updateSpacer();
    this.scroller.scrollLeft = PAD - a.x + px * z;
    this.scroller.scrollTop = PAD - a.y + py * z;
    this._saveViewState();
    this.render();
    this.app.emit('view');
  }
  zoomIn(anchor) { this.setZoom(ZOOM_LEVELS.find((l) => l > this.zoom + 1e-6) || 64, anchor); }
  zoomOut(anchor) { this.setZoom([...ZOOM_LEVELS].reverse().find((l) => l < this.zoom - 1e-6) || 0.01, anchor); }
  zoomToFit(onlyShrink = false) {
    if (!this.doc) return;
    const vw = this.viewW - PAD * 2, vh = this.viewH - PAD * 2;
    let z = Math.min(vw / this.doc.width, vh / this.doc.height);
    if (onlyShrink) z = Math.min(1, z);
    if (!isFinite(z) || z <= 0) z = 1;
    this.zoom = clamp(z, 0.01, 64);
    this._updateSpacer();
    this.scroller.scrollLeft = 0; this.scroller.scrollTop = 0;
    this._saveViewState();
    this.render();
    this.app.emit('view');
  }
  zoomToRect(r) {
    const z = clamp(Math.min((this.viewW - PAD * 2) / r.w, (this.viewH - PAD * 2) / r.h), 0.01, 64);
    this.zoom = z;
    this._updateSpacer();
    const cx = (r.x + r.w / 2) * z, cy = (r.y + r.h / 2) * z;
    this.scroller.scrollLeft = PAD + cx - this.viewW / 2;
    this.scroller.scrollTop = PAD + cy - this.viewH / 2;
    this._saveViewState();
    this.render();
    this.app.emit('view');
  }
  scrollBy(dx, dy) { this.scroller.scrollLeft += dx; this.scroller.scrollTop += dy; }

  // ---------- rendering ----------
  requestRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => { this._renderQueued = false; this.render(); });
  }

  _checkerPattern(ctx) {
    if (!this._checker) {
      const c = createCanvas(16, 16), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 16, 16);
      x.fillStyle = '#cccccc'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
      this._checker = c;
    }
    return ctx.createPattern(this._checker, 'repeat');
  }

  render() {
    const ctx = this.ctx, dpr = this.dpr, vw = this.viewW, vh = this.viewH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(this.el);
    ctx.fillStyle = cs.getPropertyValue('--workspace').trim() || '#d6d6d6';
    ctx.fillRect(0, 0, vw, vh);
    const doc = this.doc;
    if (!doc) { this.renderRulers(); return; }
    const z = this.zoom, { ox, oy } = this.origin;
    const W = doc.width, H = doc.height, cw = W * z, ch = H * z;

    // drop shadow + checkerboard
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(ox, oy, cw, ch);
    ctx.restore();
    const vx0 = Math.max(ox, 0), vy0 = Math.max(oy, 0);
    const vx1 = Math.min(ox + cw, vw), vy1 = Math.min(oy + ch, vh);
    if (vx1 > vx0 && vy1 > vy0) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillStyle = this._checkerPattern(ctx);
      ctx.fillRect(vx0 - ox, vy0 - oy, vx1 - vx0, vy1 - vy0);
      ctx.restore();

      // visible source rect
      const sx0 = Math.max(0, Math.floor(-ox / z)), sy0 = Math.max(0, Math.floor(-oy / z));
      const sx1 = Math.min(W, Math.ceil((vw - ox) / z)), sy1 = Math.min(H, Math.ceil((vh - oy) / z));
      const comp = doc.getComposite();
      ctx.imageSmoothingEnabled = z < 1;
      ctx.imageSmoothingQuality = 'high';
      if (sx1 > sx0 && sy1 > sy0) {
        ctx.drawImage(comp, sx0, sy0, sx1 - sx0, sy1 - sy0, ox + sx0 * z, oy + sy0 * z, (sx1 - sx0) * z, (sy1 - sy0) * z);
      }
      ctx.imageSmoothingEnabled = true;

      if (Settings.get('pixelGrid', false) && z >= 3) {
        ctx.save();
        ctx.beginPath();
        for (let x = sx0; x <= sx1; x++) { const X = Math.round(ox + x * z) + 0.5; ctx.moveTo(X, Math.max(vy0, oy)); ctx.lineTo(X, vy1); }
        for (let y = sy0; y <= sy1; y++) { const Y = Math.round(oy + y * z) + 0.5; ctx.moveTo(Math.max(vx0, ox), Y); ctx.lineTo(vx1, Y); }
        ctx.strokeStyle = 'rgba(128,128,128,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }

    // selection outline (marching ants)
    const tool = this.app.activeTool;
    const sel = doc.selection;
    if (!sel.empty && !(tool && tool.hidesSelection)) {
      let m = new DOMMatrix([z, 0, 0, z, ox + 0.5, oy + 0.5]);
      const tm = tool && tool.selectionMatrix;
      if (tm) m = m.multiply(tm);
      const p = new Path2D();
      p.addPath(sel.outline, m);
      this.strokeAnts(ctx, p);
    }

    if (tool) {
      ctx.save();
      tool.drawOverlay(ctx, this);
      ctx.restore();
    }
    this.renderRulers();
  }

  strokeAnts(ctx, path) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([]);
    ctx.stroke(path);
    ctx.strokeStyle = '#000';
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.antsPhase;
    ctx.stroke(path);
    ctx.restore();
  }

  renderRulers() {
    if (!this.rulers) return;
    const doc = this.doc;
    const units = Settings.get('units', 'px');
    const dpi = doc ? doc.dpi : 96;
    const perUnit = units === 'in' ? dpi : units === 'cm' ? dpi / 2.54 : 1; // pixels per unit
    const cs = getComputedStyle(this.el);
    const bg = cs.getPropertyValue('--ruler-bg').trim() || '#f3f3f3';
    const fg = cs.getPropertyValue('--text').trim() || '#222';
    const hi = cs.getPropertyValue('--ruler-sel').trim() || 'rgba(0,120,215,.25)';
    const { ox, oy } = doc ? this.origin : { ox: 0, oy: 0 };
    const z = this.zoom;
    const scale = z * perUnit; // screen px per unit
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
    let major = steps.find((s) => s * scale >= 60) || 10000;
    if (units !== 'px' && scale * 0.5 >= 60) major = [0.5, 0.25, 0.125, 0.1].find((s) => s * scale < 120 && s * scale >= 40) || major;
    const minorDiv = major * scale > 120 ? 10 : 5;
    const draw = (cv, horiz) => {
      const c = cv.getContext('2d');
      const len = horiz ? this.viewW : this.viewH, S = 18;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.fillStyle = bg;
      c.fillRect(0, 0, horiz ? len : S, horiz ? S : len);
      if (!doc) return;
      const o = horiz ? ox : oy;
      if (!doc.selection.empty) {
        const b = doc.selection.bounds;
        c.fillStyle = hi;
        const a0 = o + (horiz ? b.x : b.y) * z, a1 = o + (horiz ? b.x + b.w : b.y + b.h) * z;
        if (horiz) c.fillRect(a0, 0, a1 - a0, S); else c.fillRect(0, a0, S, a1 - a0);
      }
      c.strokeStyle = fg; c.fillStyle = fg; c.lineWidth = 1;
      c.font = '9px "Segoe UI", system-ui, sans-serif';
      c.beginPath();
      const u0 = Math.floor(-o / scale / major) * major;
      const u1 = (len - o) / scale;
      for (let u = u0; u <= u1; u += major) {
        for (let k = 0; k < minorDiv; k++) {
          const uu = u + (k * major) / minorDiv;
          const p = Math.round(o + uu * scale) + 0.5;
          const tl = k === 0 ? S : k === minorDiv / 2 ? S * 0.45 : S * 0.25;
          if (horiz) { c.moveTo(p, S); c.lineTo(p, S - tl); } else { c.moveTo(S, p); c.lineTo(S - tl, p); }
        }
        const label = String(+u.toFixed(3));
        const p = Math.round(o + u * scale) + 3;
        if (horiz) c.fillText(label, p, 9);
        else { c.save(); c.translate(9, p); c.rotate(-Math.PI / 2); c.fillText(label, -c.measureText(label).width - 2, 0); c.restore(); }
      }
      c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.beginPath();
      if (horiz) { c.moveTo(0, S - 0.5); c.lineTo(len, S - 0.5); } else { c.moveTo(S - 0.5, 0); c.lineTo(S - 0.5, len); }
      c.stroke();
      if (this.hover) {
        const p = Math.round(o + (horiz ? this.hover.x : this.hover.y) * z) + 0.5;
        c.strokeStyle = '#e5484d';
        c.beginPath();
        if (horiz) { c.moveTo(p, 0); c.lineTo(p, S); } else { c.moveTo(0, p); c.lineTo(S, p); }
        c.stroke();
      }
    };
    draw(this.rulerH, true);
    draw(this.rulerV, false);
  }

  // ---------- input ----------
  _bindInput() {
    const d = this.display;
    const touches = new Map();
    let gesture = null, panning = null, toolDrag = false;

    d.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keep focus in the text tool's input when clicking the canvas.
    d.addEventListener('mousedown', (e) => { if (this.app.activeTool?.keepsFocus) e.preventDefault(); });
    d.addEventListener('pointerdown', (e) => {
      if (!this.doc || openDialogCount()) return;
      if (document.activeElement && document.activeElement !== d && document.activeElement.blur && !this.app.activeTool?.keepsFocus) document.activeElement.blur();
      if (!this.app.activeTool?.keepsFocus) d.focus({ preventScroll: true });
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          if (toolDrag) { this.app.activeTool?.onPointerUp(e, this.toImage(e.clientX, e.clientY)); toolDrag = false; }
          const [a, b] = [...touches.values()];
          gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z: this.zoom };
          return;
        }
      }
      try { d.setPointerCapture(e.pointerId); } catch {}
      if (e.button === 1 || this.spaceDown || (this.app.activeTool && this.app.activeTool.id === 'pan')) {
        panning = { x: e.clientX, y: e.clientY };
        d.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button !== 0 && e.button !== 2) return;
      toolDrag = true;
      this.app.activeTool?.onPointerDown(e, this.toImage(e.clientX, e.clientY));
      this.requestRender();
    });
    d.addEventListener('pointermove', (e) => {
      if (!this.doc) return;
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (gesture && touches.size === 2) {
          const [a, b] = [...touches.values()];
          const nd = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const r = d.getBoundingClientRect();
          this.scrollBy(gesture.mx - mx, gesture.my - my);
          this.setZoom(gesture.z * (nd / gesture.d), { x: mx - r.left, y: my - r.top });
          gesture.mx = mx; gesture.my = my;
          return;
        }
      }
      const p = this.toImage(e.clientX, e.clientY);
      this.hover = p;
      this.app.emit('cursor', p);
      if (panning) {
        this.scrollBy(panning.x - e.clientX, panning.y - e.clientY);
        panning = { x: e.clientX, y: e.clientY };
        return;
      }
      const tool = this.app.activeTool;
      if (!tool) return;
      // Use coalesced events for smooth strokes.
      if (toolDrag) {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        if (evs.length > 1) for (const ce of evs) tool.onPointerMove(ce, this.toImage(ce.clientX, ce.clientY), e);
        else tool.onPointerMove(e, p, e);
      } else tool.onHover?.(e, p);
      if (!panning) d.style.cursor = this.spaceDown ? 'grab' : tool.getCursor(p, e);
      this.requestRender();
    });
    const up = (e) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (gesture) { if (touches.size === 0) gesture = null; return; }
      }
      if (panning) { panning = null; d.style.cursor = this.spaceDown ? 'grab' : this.app.activeTool?.getCursor(this.hover || { x: 0, y: 0 }, e) || 'default'; return; }
      if (!toolDrag) return;
      toolDrag = false;
      this.app.activeTool?.onPointerUp(e, this.toImage(e.clientX, e.clientY));
      this.requestRender();
    };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    d.addEventListener('pointerleave', () => { this.hover = null; this.app.emit('cursor', null); this.requestRender(); });
    d.addEventListener('dblclick', (e) => this.app.activeTool?.onDoubleClick?.(e, this.toImage(e.clientX, e.clientY)));
    d.addEventListener('wheel', (e) => {
      if (!this.doc) return;
      e.preventDefault();
      const r = d.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (Math.abs(e.deltaY) < 20 && e.deltaMode === 0) this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.01), anchor); // trackpad pinch
        else if (e.deltaY < 0) this.zoomIn(anchor); else this.zoomOut(anchor);
      } else {
        const k = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? this.viewH : 1;
        if (e.shiftKey && !e.deltaX) this.scrollBy(e.deltaY * k, 0);
        else this.scrollBy(e.deltaX * k, e.deltaY * k);
      }
    }, { passive: false });
  }

  setSpace(down) {
    this.spaceDown = down;
    this.display.style.cursor = down ? 'grab' : this.app.activeTool?.getCursor(this.hover || { x: 0, y: 0 }) || 'default';
  }
}
