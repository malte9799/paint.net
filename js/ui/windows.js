import { h, icon, clear, dragPointer } from './dom.js';
import { Settings } from '../storage.js';
import { clamp, debounce, createCanvas } from '../util.js';
import { toCss, toHex } from '../color.js';
import { colorDialog } from './colordialog.js';
import { t, tKeys } from '../i18n.js';

// Floating, draggable tool window (paint.net style)
export class FloatWindow {
  constructor(app, { id, title, content, footer, defaultPos, resizable = false, minW = 120, minH = 80 }) {
    this.app = app;
    this.id = id;
    this.defaultPos = defaultPos;
    const titleBar = h('div.fw-title', h('span.fw-title-text', t(title)), h('button.fw-close', { title: t('Close'), onclick: () => this.hide() }, icon('close')));
    this.body = h('div.fw-body', content);
    this.el = h('div.floatwin#win-' + id, titleBar, this.body, footer ? h('div.fw-footer', footer) : null);
    if (resizable) {
      const grip = h('div.fw-grip');
      this.el.appendChild(grip);
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const r = this.el.getBoundingClientRect();
        dragPointer(e, (dx, dy) => {
          this.el.style.width = Math.max(minW, r.width + dx) + 'px';
          this.el.style.height = Math.max(minH, r.height + dy) + 'px';
        }, () => this.save());
      });
    }
    titleBar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.fw-close')) return;
      e.preventDefault();
      const host = this.el.parentElement.getBoundingClientRect();
      const r = this.el.getBoundingClientRect();
      const x0 = r.left - host.left, y0 = r.top - host.top;
      dragPointer(e, (dx, dy) => {
        this.el.style.left = clamp(x0 + dx, -r.width + 40, host.width - 40) + 'px';
        this.el.style.top = clamp(y0 + dy, 0, host.height - 24) + 'px';
        this.el.style.right = 'auto'; this.el.style.bottom = 'auto';
      }, () => this.save());
    });
    this.el.addEventListener('pointerdown', () => this.front());
  }
  mount(host) {
    host.appendChild(this.el);
    const st = Settings.get('win.' + this.id);
    this.place(st);
    // On small screens start with only the Tools window open.
    this.visible = st ? st.visible !== false : innerWidth >= 700 || this.id === 'tools';
    this.el.style.display = this.visible ? '' : 'none';
  }
  place(st) {
    const host = this.el.parentElement.getBoundingClientRect();
    const d = this.defaultPos(host);
    const p = st && st.x != null ? st : d;
    this.el.style.left = clamp(p.x, 0, Math.max(0, host.width - 60)) + 'px';
    this.el.style.top = clamp(p.y, 0, Math.max(0, host.height - 30)) + 'px';
    if (p.w) this.el.style.width = p.w + 'px';
    if (p.h) this.el.style.height = p.h + 'px';
  }
  save() {
    const host = this.el.parentElement.getBoundingClientRect();
    const r = this.el.getBoundingClientRect();
    Settings.set('win.' + this.id, { x: r.left - host.left, y: r.top - host.top, w: this.el.style.width ? r.width : undefined, h: this.el.style.height ? r.height : undefined, visible: this.visible });
  }
  keepInside() {
    if (!this.visible || !this.el.parentElement) return;
    const host = this.el.parentElement.getBoundingClientRect();
    const r = this.el.getBoundingClientRect();
    const x = r.left - host.left, y = r.top - host.top;
    if (x > host.width - 40) this.el.style.left = Math.max(0, host.width - r.width) + 'px';
    if (y > host.height - 24) this.el.style.top = Math.max(0, host.height - r.height) + 'px';
  }
  front() {
    FloatWindow.z = (FloatWindow.z || 10) + 1;
    this.el.style.zIndex = FloatWindow.z;
  }
  show() { this.visible = true; this.el.style.display = ''; this.keepInside(); this.save(); this.app.emit('windows'); }
  hide() { this.visible = false; this.el.style.display = 'none'; this.save(); this.app.emit('windows'); }
  toggle() { this.visible ? this.hide() : this.show(); }
  reset() { this.el.style.width = ''; this.el.style.height = ''; Settings.set('win.' + this.id, null); this.place(null); this.show(); }
}

// ---------------- Tools window ----------------
export function createToolsWindow(app) {
  const grid = h('div.tools-grid');
  const btns = new Map();
  for (const tool of app.tools.values()) {
    const b = h('button.tool-btn', { title: `${t(tool.name)} (${tool.key})`, onclick: () => app.setTool(tool.id) }, icon(tool.icon));
    btns.set(tool.id, b);
    grid.appendChild(b);
  }
  const upd = () => btns.forEach((b, id) => b.classList.toggle('active', app.activeTool.id === id));
  app.on('tool', upd);
  upd();
  return new FloatWindow(app, { id: 'tools', title: 'Tools', content: grid, defaultPos: () => ({ x: 8, y: 8 }) });
}

// ---------------- History window ----------------
export function createHistoryWindow(app) {
  const list = h('div.history-list', { role: 'listbox' });
  const B = (cmd, ic, title, fn) => h('button.fw-btn', { title: t(title), onclick: fn }, icon(ic));
  const bFirst = B('first', 'first', 'Undo to beginning', () => { app.commitTool(); app.activeDoc?.history.goto(0); });
  const bUndo = B('undo', 'undo', 'Undo (' + tKeys('Ctrl+Z') + ')', () => app.run('edit.undo'));
  const bRedo = B('redo', 'redo', 'Redo (' + tKeys('Ctrl+Y') + ')', () => app.run('edit.redo'));
  const bLast = B('last', 'last', 'Redo to end', () => { app.commitTool(); const d = app.activeDoc; d?.history.goto(d.history.items.length - 1); });
  const footer = h('div.fw-buttons', bFirst, bUndo, bRedo, bLast);
  const render = () => {
    clear(list);
    const d = app.activeDoc;
    const hist = d?.history;
    if (hist) {
      hist.items.forEach((it, i) => {
        const row = h('div.history-item' + (i === hist.current ? '.current' : '') + (i > hist.current ? '.redo' : ''),
          { onclick: () => { app.commitTool(); hist.goto(i); } }, icon(it.icon || 'image'), h('span', t(it.name)));
        list.appendChild(row);
      });
      list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
    }
    bFirst.disabled = bUndo.disabled = !hist?.canUndo;
    bRedo.disabled = bLast.disabled = !hist?.canRedo;
  };
  app.on('history', render);
  app.on('activedoc', render);
  render();
  return new FloatWindow(app, { id: 'history', title: 'History', content: list, footer, resizable: true, defaultPos: (r) => ({ x: r.width - 228, y: 8, w: 220, h: 200 }) });
}

// ---------------- Layers window ----------------
export function createLayersWindow(app) {
  const list = h('div.layers-list', { role: 'listbox' });
  const B = (cmd) => { const c = app.commands.get(cmd); const b = h('button.fw-btn', { title: t(c.label.replace(/…$/, '')) + (c.shortcut ? ` (${tKeys(c.shortcut)})` : ''), onclick: () => app.run(cmd) }, icon(c.icon)); b._cmd = cmd; return b; };
  const btns = ['layers.add', 'layers.delete', 'layers.duplicate', 'layers.merge', 'layers.up', 'layers.down', 'layers.properties'].map(B);
  const footer = h('div.fw-buttons', btns);
  const thumbs = new Map();
  const drawThumb = (cv, layer, d) => {
    const s = Math.min(cv.width / d.width, cv.height / d.height);
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    const w = d.width * s, hh = d.height * s, x = (cv.width - w) / 2, y = (cv.height - hh) / 2;
    // checkerboard
    for (let yy = 0; yy < hh; yy += 4) for (let xx = 0; xx < w; xx += 4) {
      c.fillStyle = ((xx + yy) / 4) % 2 ? '#ccc' : '#fff';
      c.fillRect(x + xx, y + yy, Math.min(4, w - xx), Math.min(4, hh - yy));
    }
    c.imageSmoothingQuality = 'high';
    c.drawImage(layer.canvas, x, y, w, hh);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
  };
  let dragFrom = null;
  const render = () => {
    clear(list);
    thumbs.clear();
    const d = app.activeDoc;
    if (d) {
      for (let i = d.layers.length - 1; i >= 0; i--) {
        const l = d.layers[i];
        const cv = h('canvas.layer-thumb', { width: 48, height: 36 });
        drawThumb(cv, l, d);
        thumbs.set(l, cv);
        const vis = h('input.layer-vis', { type: 'checkbox', checked: l.visible, title: t('Visible') });
        vis.addEventListener('click', (e) => e.stopPropagation());
        vis.addEventListener('change', () => app.layerOp(vis.checked ? 'Layer Shown' : 'Layer Hidden', 'eye', () => { l.visible = vis.checked; }));
        const row = h('div.layer-item' + (i === d.activeIndex ? '.active' : ''), { draggable: true, onclick: () => { d.setActiveLayer(i); }, ondblclick: () => { d.setActiveLayer(i); app.run('layers.properties'); } },
          cv, h('span.layer-name', l.name), vis);
        row.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
        row.addEventListener('dragover', (e) => { if (dragFrom != null) { e.preventDefault(); row.classList.add('drop'); } });
        row.addEventListener('dragleave', () => row.classList.remove('drop'));
        row.addEventListener('drop', (e) => {
          e.preventDefault(); row.classList.remove('drop');
          const from = dragFrom, to = i; dragFrom = null;
          if (from == null || from === to) return;
          app.layerOp('Move Layer', from < to ? 'layerup' : 'layerdown', (dd) => {
            const [l2] = dd.layers.splice(from, 1);
            dd.layers.splice(to, 0, l2);
            dd.activeIndex = to;
          });
        });
        list.appendChild(row);
      }
    }
    for (const b of btns) b.disabled = !app.commands.get(b._cmd).enabled();
  };
  const refreshThumbs = debounce(() => {
    const d = app.activeDoc;
    if (!d) return;
    for (const [l, cv] of thumbs) drawThumb(cv, l, d);
  }, 250);
  app.on('layers', render);
  app.on('activedoc', render);
  app.on('history', () => { for (const b of btns) b.disabled = !app.commands.get(b._cmd).enabled(); });
  app.on('pixels', refreshThumbs);
  render();
  return new FloatWindow(app, { id: 'layers', title: 'Layers', content: list, footer, resizable: true, defaultPos: (r) => ({ x: r.width - 228, y: Math.max(220, r.height - 230), w: 220, h: 220 }) });
}

// ---------------- Colors window ----------------
export function createColorsWindow(app) {
  const prim = h('button.swatch.primary', { title: t('Primary color — click to edit') });
  const sec = h('button.swatch.secondary', { title: t('Secondary color — click to edit') });
  const swap = h('button.swatch-swap', { title: t('Swap colors') + ' (X)', onclick: () => app.swapColors() }, icon('swap'));
  const reset = h('button.swatch-reset', { title: t('Reset to black and white'), onclick: () => app.resetColors() });
  reset.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="4.5" y="4.5" width="7" height="7" fill="#fff" stroke="#000"/><rect x=".5" y=".5" width="7" height="7" fill="#000" stroke="#000"/></svg>';
  prim.addEventListener('click', () => colorDialog(app, 'primary'));
  sec.addEventListener('click', () => colorDialog(app, 'secondary'));
  const sw = h('div.swatches', sec, prim, swap, reset);
  const primHex = h('div.color-hex');
  const pal = h('div.palette');
  const renderPal = () => {
    clear(pal);
    app.palette.forEach((c, i) => {
      const s = h('button.pal-swatch', { title: '#' + toHex(c, c.a < 255) + '\n' + t('Left click: set primary, Right click: set secondary, Shift+click: store current primary here') });
      s.style.setProperty('--c', toCss(c));
      s.addEventListener('click', (e) => { if (e.shiftKey) app.setPaletteColor(i, app.primary); else app.setPrimary({ ...c }); });
      s.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.shiftKey) app.setPaletteColor(i, app.secondary); else app.setSecondary({ ...c }); });
      pal.appendChild(s);
    });
  };
  const render = () => {
    prim.style.setProperty('--c', toCss(app.primary));
    sec.style.setProperty('--c', toCss(app.secondary));
    primHex.textContent = '#' + toHex(app.primary, app.primary.a < 255);
  };
  app.on('colors', render);
  app.on('palette', renderPal);
  render();
  renderPal();
  const content = h('div.colors-win', h('div.colors-top', sw, h('div.colors-info', primHex, h('button.btn.small', { onclick: () => colorDialog(app, 'primary') }, t('More') + ' >>'))), pal);
  return new FloatWindow(app, { id: 'colors', title: 'Colors', content, defaultPos: (r) => ({ x: 8, y: Math.max(300, r.height - 228) }) });
}

export { createCanvas };
