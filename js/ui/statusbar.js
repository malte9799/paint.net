import { h, icon, clear } from './dom.js';
import { showPopup, closeAllMenus } from './menubar.js';
import { ZOOM_LEVELS } from '../view.js';
import { Settings } from '../storage.js';
import { clamp } from '../util.js';
import { t, tKeys } from '../i18n.js';

const UNITS = [['px', 'Pixels'], ['in', 'Inches'], ['cm', 'Centimeters']];

function svgIcon(body) { const s = h('span.icon'); s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.1">${body}</svg>`; return s; }

export class StatusBar {
  constructor(app, host) {
    this.app = app;
    this.hintIcon = h('span.sb-hint-icon');
    this.hint = h('span.sb-hint-text');
    this.sel = h('span.sb-val');
    this.pos = h('span.sb-val');
    this.size = h('span.sb-val');
    this.unitBtn = h('button.sb-units.dropdown-btn', { title: t('Units') });
    this.unitBtn.addEventListener('click', () => {
      closeAllMenus();
      const r = this.unitBtn.getBoundingClientRect();
      const m = showPopup(app, UNITS.map(([u, l]) => ({ label: l, checked: () => Settings.get('units', 'px') === u, run: () => app.run('view.units.' + u) })), r.left, r.top, null);
      requestAnimationFrame(() => { const pr = m.el.getBoundingClientRect(); m.el.style.top = r.top - pr.height + 'px'; });
    });
    this.zoomSlider = h('input.sb-zoom-slider', { type: 'range', min: 0, max: 1000, step: 1, title: t('Zoom') });
    this.zoomSlider.addEventListener('input', () => {
      const k = +this.zoomSlider.value / 1000;
      app.view.setZoom(Math.exp(Math.log(0.01) + k * (Math.log(64) - Math.log(0.01))));
    });
    this.zoomInput = h('input.sb-zoom-input', { type: 'text', title: t('Zoom') });
    this.zoomInput.addEventListener('change', () => {
      const v = parseFloat(this.zoomInput.value);
      if (v > 0) app.view.setZoom(clamp(v / 100, 0.01, 64)); else this.update();
    });
    this.zoomInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.zoomInput.blur(); });
    const zoomDrop = h('button.combo-drop.dropdown-btn', { title: t('Zoom presets') }, icon('chevdown'));
    zoomDrop.addEventListener('click', () => {
      closeAllMenus();
      const r = this.zoomInput.getBoundingClientRect();
      const levels = [...ZOOM_LEVELS].filter((z) => z >= 0.05).reverse().map((z) => ({ label: fmtZoom(z), run: () => app.view.setZoom(z) }));
      const m = showPopup(app, [{ label: 'Window', run: () => app.view.zoomToFit() }, ...levels], r.left, r.top, null);
      requestAnimationFrame(() => { const pr = m.el.getBoundingClientRect(); m.el.style.top = Math.max(0, r.top - pr.height) + 'px'; });
    });
    this.el = h('footer.statusbar',
      h('div.sb-left', this.hintIcon, this.hint),
      h('div.sb-right',
        h('span.sb-item', { title: t('Selection size') }, svgIcon('<rect x="2.5" y="3.5" width="11" height="9" stroke-dasharray="2 1.5"/>'), this.sel),
        h('span.sb-item', { title: t('Cursor position') }, svgIcon('<path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4"/><circle cx="8" cy="8" r="1"/>'), this.pos),
        h('span.sb-item', { title: t('Image size') }, svgIcon('<rect x="2.5" y="2.5" width="11" height="11"/><path d="M5 11l2-3 2 2 2-3"/>'), this.size),
        this.unitBtn,
        h('span.sb-zoom',
          h('button.sb-zbtn', { title: t('Zoom out'), onclick: () => app.view.zoomOut() }, icon('zoomout')),
          this.zoomSlider,
          h('button.sb-zbtn', { title: t('Zoom in'), onclick: () => app.view.zoomIn() }, icon('zoomin')),
          h('span.combo', this.zoomInput, zoomDrop))));
    host.appendChild(this.el);
    this.selRect = null;
    app.on('tool', () => this.updateHint());
    app.on('cursor', (p) => this.updatePos(p));
    app.on('view', () => this.update());
    app.on('activedoc', () => this.update());
    app.on('size', () => this.update());
    app.on('selection', () => this.update());
    app.on('settings', () => this.update());
    app.on('selectionsize', (r) => { this.selRect = r; this.update(); });
    this.updateHint();
    this.update();
  }
  conv(v) {
    const u = Settings.get('units', 'px'), dpi = this.app.activeDoc?.dpi || 96;
    if (u === 'in') return (v / dpi).toFixed(2);
    if (u === 'cm') return ((v / dpi) * 2.54).toFixed(2);
    return String(Math.round(v));
  }
  updateHint() {
    const tool = this.app.activeTool;
    clear(this.hintIcon).appendChild(icon(tool.icon));
    this.hint.textContent = this.flash || `${t(tool.name)}: ${t(tool.hint)}`;
  }
  flashMessage(msg) {
    this.flash = t(msg);
    this.updateHint();
    clearTimeout(this._ft);
    this._ft = setTimeout(() => { this.flash = null; this.updateHint(); }, 4000);
  }
  updatePos(p) {
    this.pos.textContent = p ? `${this.conv(Math.floor(p.x))}, ${this.conv(Math.floor(p.y))}` : '';
  }
  update() {
    const d = this.app.activeDoc;
    const u = Settings.get('units', 'px');
    this.unitBtn.textContent = t(UNITS.find(([k]) => k === u)[1]);
    this.unitBtn.appendChild(icon('chevdown', 'opt-chev'));
    if (!d) { this.sel.textContent = this.size.textContent = this.pos.textContent = ''; return; }
    const r = this.selRect || (d.selection.empty ? null : d.selection.bounds);
    this.sel.textContent = r ? `${this.conv(Math.abs(r.w))} × ${this.conv(Math.abs(r.h))}` : `0 × 0`;
    this.size.textContent = `${this.conv(d.width)} × ${this.conv(d.height)}`;
    const z = this.app.view.zoom;
    if (document.activeElement !== this.zoomInput) this.zoomInput.value = fmtZoom(z);
    this.zoomSlider.value = Math.round(((Math.log(z) - Math.log(0.01)) / (Math.log(64) - Math.log(0.01))) * 1000);
  }
}

function fmtZoom(z) {
  const p = z * 100;
  return (p >= 10 ? Math.round(p) : +p.toFixed(1)) + '%';
}
