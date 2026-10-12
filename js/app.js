import { Emitter, debounce, createCanvas, isMac } from './util.js';
import { Document, Layer } from './document.js';
import { BLACK, WHITE, defaultPalette } from './color.js';
import { Settings, idb, serializeDoc, deserializeDoc } from './storage.js';
import { CanvasView } from './view.js';
import { createTools } from './tools/index.js';
import { buildCommands } from './commands.js';
import { MenuBar, closeAllMenus } from './ui/menubar.js';
import { TopBar, MainToolbar } from './ui/toolbar.js';
import { ToolOptionsBar } from './ui/tooloptions.js';
import { StatusBar } from './ui/statusbar.js';
import { createToolsWindow, createHistoryWindow, createLayersWindow, createColorsWindow } from './ui/windows.js';
import { h, icon } from './ui/dom.js';
import { Dialog, openDialogCount } from './ui/dialog.js';
import { pasteTooLargeDialog } from './ui/dialogs.js';
import { recordDocOp } from './history.js';
import { transformLayers, transformSelection } from './commands.js';
import { openFiles } from './fileio.js';
import { blobToCanvas } from './util.js';
import { toCss } from './color.js';
import { saveDocument } from './fileio.js';
import { t, tKeys } from './i18n.js';

export const DEFAULT_TOOL_SETTINGS = {
  brushWidth: 2, hardness: 75, antialias: true, blendMode: 'normal',
  selectionMode: 'replace', floodMode: 'contiguous', tolerance: 0.5, sampling: 'layer',
  font: 'Segoe UI', fontSize: 12, fontStyle: { bold: false, italic: false, underline: false, strike: false }, textAlign: 'left',
  pickerSampling: 1, pickerSource: 'layer', pickerAfter: 'none',
  gradientType: 'linear', gradientMode: 'color',
  shapeType: 'rectangle', shapeDraw: 'outline', lineStyle: 'solid', arrows: 'none',
  moveQuality: 'bilinear',
};

export class App extends Emitter {
  constructor(root) {
    super();
    this.root = root;
    this.documents = [];
    this.activeDoc = null;
    this.clipboard = null;
    this.lastEffect = null;
    this.primary = Settings.get('primary', { ...BLACK });
    this.secondary = Settings.get('secondary', { ...WHITE });
    this.palette = Settings.get('palette', null) || defaultPalette();
    this.toolSettings = { ...DEFAULT_TOOL_SETTINGS, ...Settings.get('toolSettings', {}) };
    this.tools = createTools(this);
    this.activeTool = this.tools.get(Settings.get('tool', 'paintbrush')) || this.tools.get('paintbrush');
    this.previousToolId = null;
    this.commands = buildCommands(this);
    this.windows = {};
    this.applyTheme();
    this.buildUI();
    this.bindKeys();
    this.bindDrop();
    this._autosave = new Map();
  }

  // ---------------- UI ----------------
  buildUI() {
    const r = this.root;
    const titlebar = h('header.titlebar', h('div.app-logo', { title: 'paint.net' }, icon('app')));
    const tbHost = h('div.toolbar-host');
    const optHost = h('div.tooloptions-host');
    this.workspace = h('main.workspace');
    const sbHost = h('div.statusbar-host');
    r.append(titlebar, tbHost, optHost, this.workspace, sbHost, h('div#print-holder'));
    this.menubar = new MenuBar(this, titlebar);
    this.docTitle = h('div.doc-title');
    titlebar.appendChild(this.docTitle);
    this.topbar = new TopBar(this, titlebar);
    this.toolbar = new MainToolbar(this, tbHost);
    this.toolOptions = new ToolOptionsBar(this, optHost);
    this.view = new CanvasView(this, this.workspace);
    this.winLayer = h('div.window-layer');
    this.workspace.appendChild(this.winLayer);
    this.emptyMsg = h('div.empty-msg', h('div', t('No images are open.')), h('div.empty-actions',
      h('button.btn', { onclick: () => this.run('file.new') }, icon('new'), ' ' + t('New image')),
      h('button.btn', { onclick: () => this.run('file.open') }, icon('open'), ' ' + t('Open…'))),
    h('div.hint', t('You can also drag and drop image files here, or paste an image ({key}).', { key: tKeys('Ctrl+V') })));
    this.workspace.appendChild(this.emptyMsg);
    this.statusbar = new StatusBar(this, sbHost);
    this.windows.tools = createToolsWindow(this);
    this.windows.colors = createColorsWindow(this);
    this.windows.history = createHistoryWindow(this);
    this.windows.layers = createLayersWindow(this);
    for (const w of Object.values(this.windows)) w.mount(this.winLayer);
    this.emit('windows');
    new ResizeObserver(() => Object.values(this.windows).forEach((w) => w.keepInside())).observe(this.winLayer);
    this.on('activedoc', () => this.updateTitle());
    this.on('meta', () => this.updateTitle());
    this.on('history', () => this.updateTitle());
    this.updateEmpty();
  }

  applyTheme() {
    const t = Settings.get('theme', 'system');
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--accent', Settings.get('accent', '#0067c0'));
    document.documentElement.classList.toggle('translucent', Settings.get('translucent', true));
    if (!this._themeListener) {
      this._themeListener = true;
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.applyTheme());
    }
    this.view?.requestRender();
  }

  updateTitle() {
    const d = this.activeDoc;
    const name = d ? d.name + (d.dirty ? '*' : '') : '';
    this.docTitle.textContent = name;
    document.title = (d ? name + ' - ' : '') + 'paint.net';
  }
  updateEmpty() { this.emptyMsg.style.display = this.documents.length ? 'none' : ''; }

  setBusy(b) { document.body.classList.toggle('busy', b); }
  flashStatus(msg) { this.statusbar.flashMessage(msg); }

  // ---------------- documents ----------------
  addDocument(doc, activate = true) {
    this.documents.push(doc);
    const fwd = (ev) => (...a) => { if (doc === this.activeDoc) this.emit(ev, ...a); };
    doc.on('history', () => { fwd('history')(); this.emit('meta'); this.scheduleAutosave(doc); });
    doc.on('layers', fwd('layers'));
    doc.on('activelayer', () => { if (doc === this.activeDoc) { this.commitTool(); this.emit('layers'); } });
    doc.on('selection', () => { if (doc === this.activeDoc) { this.emit('selection'); this.view.requestRender(); } });
    doc.on('pixels', (r) => { if (doc === this.activeDoc) { this.view.requestRender(); this.emit('pixels', r); } });
    doc.on('size', () => { if (doc === this.activeDoc) { this.view.layout(); this.emit('size'); } });
    doc.on('meta', () => this.emit('meta'));
    this.emit('docs');
    if (activate) this.setActiveDocument(doc);
    this.updateEmpty();
    this.scheduleAutosave(doc, true);
    this.saveSessionList();
    return doc;
  }

  setActiveDocument(doc) {
    if (doc === this.activeDoc) return;
    this.commitTool();
    this.activeDoc = doc;
    this.view.setDocument(doc);
    this.saveSessionList();
    this.emit('activedoc');
    this.emit('layers');
    this.emit('history');
    this.emit('selection');
  }

  cycleDocument(dir) {
    if (this.documents.length < 2) return;
    const i = this.documents.indexOf(this.activeDoc);
    this.setActiveDocument(this.documents[(i + dir + this.documents.length) % this.documents.length]);
  }

  async closeDocument(doc) {
    if (!doc) return false;
    if (doc === this.activeDoc) this.commitTool();
    if (doc.dirty) {
      this.setActiveDocument(doc);
      const res = await new Dialog({
        title: 'Unsaved Changes', icon: 'warning', width: 440,
        content: h('div.msgbox', h('div.msgbox-icon', icon('warning')), h('div.msgbox-text', t('Save changes to "{name}" before closing?', { name: doc.name }))),
        buttons: [{ label: 'Save', value: 'save', primary: true }, { label: "Don't Save", value: 'discard' }, { label: 'Cancel', value: 'cancel', cancel: true }],
      }).show();
      if (res === 'cancel') return false;
      if (res === 'save' && !(await saveDocument(this, doc))) return false;
    }
    const i = this.documents.indexOf(doc);
    this.documents.splice(i, 1);
    idb.delete('session', doc.id).catch(() => {});
    if (doc === this.activeDoc) {
      this.activeDoc = null;
      const next = this.documents[Math.min(i, this.documents.length - 1)] || null;
      if (next) this.setActiveDocument(next);
      else { this.view.setDocument(null); this.emit('activedoc'); this.emit('layers'); this.emit('history'); }
    }
    this.emit('docs');
    this.updateEmpty();
    this.saveSessionList();
    return true;
  }

  // ---------------- session persistence (IndexedDB) ----------------
  scheduleAutosave(doc, immediate = false) {
    if (!Settings.get('autosave', true)) return;
    let fn = this._autosave.get(doc);
    if (!fn) {
      fn = debounce(async () => {
        if (!this.documents.includes(doc)) return;
        try { await idb.put('session', await serializeDoc(doc)); } catch (e) { console.warn('Autosave failed', e); }
      }, 1200);
      this._autosave.set(doc, fn);
    }
    immediate ? fn.flush() : fn();
  }
  saveSessionList() {
    Settings.set('session', { ids: this.documents.map((d) => d.id), active: this.activeDoc?.id });
  }
  async restoreSession() {
    const s = Settings.get('session', null);
    if (!s || !s.ids?.length || !Settings.get('autosave', true)) return false;
    let active = null;
    for (const id of s.ids) {
      try {
        const rec = await idb.get('session', id);
        if (!rec) continue;
        const d = await deserializeDoc(rec);
        this.addDocument(d, false);
        if (id === s.active) active = d;
      } catch (e) { console.warn('Could not restore', id, e); }
    }
    if (!this.documents.length) return false;
    this.setActiveDocument(active || this.documents[0]);
    return true;
  }
  async clearStoredData() {
    await idb.clear('session').catch(() => {});
    await idb.clear('recent').catch(() => {});
    for (const d of this.documents) this.scheduleAutosave(d);
  }
  resetSettings() {
    Settings.reset();
    this.toolSettings = { ...DEFAULT_TOOL_SETTINGS };
    this.emit('toolsettings');
    this.resetWindows();
    this.applyTheme();
    this.saveSessionList();
  }
  resetWindows() { for (const w of Object.values(this.windows)) w.reset(); this.emit('windows'); }

  // ---------------- tools ----------------
  setTool(id) {
    const t = this.tools.get(id);
    if (!t || t === this.activeTool) return;
    this.activeTool.deactivate();
    this.previousToolId = this.activeTool.id;
    this.activeTool = t;
    t.activate();
    Settings.set('tool', id);
    this.emit('tool');
    this.view.requestRender();
    this.view.display.style.cursor = t.getCursor({ x: 0, y: 0 });
  }
  commitTool() { if (this.activeTool?.hasPending || this.activeTool?.sess) this.activeTool.commit(); }
  setToolSetting(key, v) {
    this.toolSettings[key] = v;
    Settings.set('toolSettings', this.toolSettings);
    this.emit('toolsettings', key);
    this.activeTool.onSettingChanged(key);
    this.view.requestRender();
  }

  // ---------------- colors ----------------
  setPrimary(c) { this.primary = { ...c }; Settings.set('primary', this.primary); this.emit('colors'); this.activeTool.onColorsChanged?.(); }
  setSecondary(c) { this.secondary = { ...c }; Settings.set('secondary', this.secondary); this.emit('colors'); this.activeTool.onColorsChanged?.(); }
  swapColors() { const p = this.primary; this.setPrimary(this.secondary); this.setSecondary(p); }
  resetColors() { this.setPrimary(BLACK); this.setSecondary(WHITE); }
  setPaletteColor(i, c) { this.palette[i] = { ...c }; Settings.set('palette', this.palette); this.emit('palette'); }
  resetPalette() { this.palette = defaultPalette(); Settings.set('palette', null); this.emit('palette'); }

  // ---------------- commands ----------------
  async run(id, ...args) {
    const c = this.commands.get(id);
    if (!c) { console.warn('Unknown command', id); return; }
    if (!c.enabled()) return;
    closeAllMenus();
    try { await c.run(...args); } catch (e) { console.error(`Command ${id} failed`, e); this.flashStatus(t('Error') + ': ' + (e.message || e)); }
    this.emit('history'); // refresh enabled states
  }

  resizeCanvas(d, w, hgt, anchor, name, fillBg = true) {
    const ox = Math.round((w - d.width) * anchor[0]), oy = Math.round((hgt - d.height) * anchor[1]);
    const W0 = d.width, H0 = d.height;
    recordDocOp(d, name, 'canvassize', () => {
      transformLayers(d, w, hgt, (c, l, i) => {
        if (i === 0 && fillBg) { c.fillStyle = toCss(this.secondary); c.fillRect(0, 0, w, hgt); c.clearRect(ox, oy, W0, H0); }
        c.drawImage(l.canvas, ox, oy);
      });
      transformSelection(d, w, hgt, new DOMMatrix([1, 0, 0, 1, ox, oy]));
    });
    d.emit('size'); d.emit('layers'); d.emit('selection'); d.invalidate();
  }

  // ---------------- paste ----------------
  async pasteCanvas(canvas, pos) {
    let d = this.activeDoc;
    if (!d) { this.pasteAsNewImage(canvas); return; }
    this.commitTool();
    if (canvas.width > d.width || canvas.height > d.height) {
      const r = await pasteTooLargeDialog();
      if (r === 'cancel') return;
      if (r === 'expand') this.resizeCanvas(d, Math.max(d.width, canvas.width), Math.max(d.height, canvas.height), [0, 0], 'Expand Canvas');
    }
    let x, y;
    const v = this.view;
    const vis = { x: Math.max(0, Math.floor(v.toImage(v.display.getBoundingClientRect().left, 0).x)), y: Math.max(0, Math.floor(v.toImage(0, v.display.getBoundingClientRect().top).y)) };
    if (pos && pos.x + canvas.width <= d.width && pos.y + canvas.height <= d.height) { x = pos.x; y = pos.y; } else { x = Math.min(vis.x, Math.max(0, d.width - canvas.width)); y = Math.min(vis.y, Math.max(0, d.height - canvas.height)); }
    this.setTool('moveselected');
    this.tools.get('moveselected').beginPaste(canvas, x, y);
  }
  pasteAsNewImage(canvas) {
    const d = new Document(canvas.width, canvas.height, { baseName: 'Paste into New Image', baseIcon: 'pasteimage' });
    d.layers.push(Layer.fromCanvas(canvas, t('Background')));
    this.addDocument(d);
    d.markDirty();
  }

  // ---------------- keyboard ----------------
  bindKeys() {
    const keyName = (e) => {
      let k = e.key;
      if (k === ' ') k = 'Space';
      if (k.length === 1) k = k.toUpperCase();
      if (k === '=' || k === '+') k = '+';
      if (k === '_') k = '-';
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey && !(k === '+' && !/^Shift/.test(k))) parts.push('Shift');
      parts.push(k);
      return parts.join('+');
    };
    const map = new Map();
    for (const c of this.commands.values()) if (c.shortcut) map.set(c.shortcut, c.id);
    map.set('Ctrl+Shift++', 'view.zoomin'); map.set('Ctrl+Shift+-', 'view.zoomout');
    map.set('Ctrl+Shift+Z', 'layers.rotatezoom');
    map.set('Ctrl+Alt+Z', 'edit.redo');

    window.addEventListener('keydown', (e) => {
      if (openDialogCount()) return;
      const tgt = e.target;
      const typing = tgt && (/^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName) || tgt.isContentEditable);
      if (typing) return;
      if (e.key === ' ' && !e.repeat) { this.view.setSpace(true); e.preventDefault(); return; }
      if (e.key === 'Escape') closeAllMenus();
      if (this.activeTool.onKeyDown(e)) { e.preventDefault(); this.view.requestRender(); return; }
      const name = keyName(e);
      // Let the native paste event deliver clipboard images (no permission prompt).
      if (name === 'Ctrl+V') return;
      const cmd = map.get(name);
      if (cmd) { e.preventDefault(); this.run(cmd); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (k === 'X') { this.swapColors(); return; }
      if (e.key === '[' || e.key === ']') {
        const w = this.toolSettings.brushWidth, step = w < 10 ? 1 : w < 50 ? 5 : w < 200 ? 10 : 50;
        this.setToolSetting('brushWidth', Math.max(1, Math.min(2000, w + (e.key === ']' ? step : -step))));
        return;
      }
      if (/^[A-Z]$/.test(k)) {
        const list = [...this.tools.values()].filter((t) => t.key === k);
        if (!list.length) return;
        const i = list.indexOf(this.activeTool);
        this.setTool(list[(i + 1) % list.length].id);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') this.view.setSpace(false); });
    window.addEventListener('paste', async (e) => {
      if (openDialogCount()) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
      const items = [...(e.clipboardData?.items || [])];
      const img = items.find((i) => i.type.startsWith('image/'));
      e.preventDefault();
      if (img) {
        const canvas = await blobToCanvas(img.getAsFile());
        const pos = this.matchInternalClipboard?.(canvas);
        if (!this.activeDoc) this.pasteAsNewImage(canvas); else this.pasteCanvas(canvas, pos);
      } else if (this.clipboard) {
        const c = createCanvas(this.clipboard.canvas.width, this.clipboard.canvas.height);
        c.getContext('2d').drawImage(this.clipboard.canvas, 0, 0);
        if (!this.activeDoc) this.pasteAsNewImage(c); else this.pasteCanvas(c, this.clipboard.pos);
      } else {
        this.flashStatus('The clipboard does not contain an image.');
      }
    });
    window.addEventListener('beforeunload', (e) => {
      for (const fn of this._autosave.values()) fn.flush();
      // Without autosave, unsaved work would be lost: ask the browser to confirm.
      if (!Settings.get('autosave', true) && this.documents.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  bindDrop() {
    const ws = this.workspace;
    ws.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); ws.classList.add('dragging'); } });
    ws.addEventListener('dragleave', () => ws.classList.remove('dragging'));
    ws.addEventListener('drop', async (e) => {
      ws.classList.remove('dragging');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      const entries = [...e.dataTransfer.files].map((file) => ({ file, handle: null }));
      await openFiles(this, entries);
    });
  }

  async start() {
    const restored = await this.restoreSession();
    if (!restored) {
      const d = new Document(800, 600, { background: '#ffffff' });
      this.addDocument(d);
    }
    // Launch queue (PWA file handling)
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (params) => {
        const entries = await Promise.all((params.files || []).map(async (hd) => ({ file: await hd.getFile(), handle: hd })));
        if (entries.length) openFiles(this, entries);
      });
    }
    this.emit('tool');
    this.view.layout();
  }
}

export { isMac };
