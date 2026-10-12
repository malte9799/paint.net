import { Document, Layer, CANVAS_OPS } from './document.js';
import { recordDocOp, layersState, layersItem, pixelItem } from './history.js';
import { selectionItem } from './selection.js';
import { createCanvas, cloneCanvas, canvasToBlob, blobToCanvas, Rect } from './util.js';
import { toCss } from './color.js';
import { pickFiles, openFiles, saveDocument, readImageFile } from './fileio.js';
import { newImageDialog, resizeDialog, canvasSizeDialog, layerPropertiesDialog, rotateZoomDialog, pasteTooLargeDialog, settingsDialog, aboutDialog, shortcutsDialog } from './ui/dialogs.js';
import { confirmBox, messageBox, Dialog } from './ui/dialog.js';
import { Settings, listRecent, deserializeDoc } from './storage.js';
import { EFFECTS } from './effects/registry.js';
import { runEffectCommand } from './effects/runner.js';
import { h } from './ui/dom.js';
import { t } from './i18n.js';

// Replace every layer's canvas with a new one of size (w,h) produced by draw(ctx, layer, index)
function transformLayers(doc, w, h, draw) {
  doc.layers.forEach((l, i) => {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    draw(ctx, l, i);
    l.canvas = c;
  });
  doc.width = w;
  doc.height = h;
  doc.compositeResized();
}

function transformSelection(doc, w, h, matrix) {
  const snap = doc.selection.empty ? null : cloneCanvas(doc.selection.mask);
  doc.selection.resize(w, h);
  if (snap && matrix) doc.selection.setFromCanvas(snap, matrix);
}

function afterGeometry(app, doc) {
  doc.emit('size');
  doc.emit('layers');
  doc.emit('selection');
  doc.invalidate();
  app.view.zoomToFit(true);
}

export function buildCommands(app) {
  const C = new Map();
  const doc = () => app.activeDoc;
  const hasDoc = () => !!app.activeDoc;
  const hasSel = () => !!app.activeDoc && !app.activeDoc.selection.empty;
  const def = (id, o) => C.set(id, { id, enabled: hasDoc, ...o });

  // ---------------- File ----------------
  def('file.new', {
    label: 'New…', icon: 'new', shortcut: 'Ctrl+N', enabled: () => true,
    async run() {
      const r = await newImageDialog(app);
      if (!r) return;
      const bg = r.background === 'white' ? '#ffffff' : r.background === 'secondary' ? toCss(app.secondary) : null;
      const d = new Document(r.width, r.height, { dpi: r.dpi, background: bg });
      app.addDocument(d);
    },
  });
  def('file.open', { label: 'Open…', icon: 'open', shortcut: 'Ctrl+O', enabled: () => true, async run() { await openFiles(app, await pickFiles()); } });
  def('file.save', { label: 'Save', icon: 'save', shortcut: 'Ctrl+S', run: () => saveDocument(app, doc(), false) });
  def('file.saveas', { label: 'Save As…', icon: 'saveas', shortcut: 'Ctrl+Shift+S', run: () => saveDocument(app, doc(), true) });
  def('file.saveall', {
    label: 'Save All', icon: 'saveall', shortcut: 'Ctrl+Alt+S',
    async run() { for (const d of [...app.documents]) if (d.dirty) { app.setActiveDocument(d); if (!(await saveDocument(app, d))) break; } },
  });
  def('file.close', { label: 'Close', icon: 'close', shortcut: 'Ctrl+W', run: () => app.closeDocument(doc()) });
  def('file.closeall', {
    label: 'Close All', icon: 'close', shortcut: 'Ctrl+Shift+W',
    async run() { for (const d of [...app.documents]) if (!(await app.closeDocument(d))) break; },
  });
  def('file.print', {
    label: 'Print…', icon: 'print', shortcut: 'Ctrl+P',
    async run() {
      app.commitTool();
      const url = URL.createObjectURL(await canvasToBlob(doc().flatten()));
      const holder = document.getElementById('print-holder');
      holder.innerHTML = '';
      const img = h('img', { src: url });
      holder.appendChild(img);
      await img.decode().catch(() => {});
      window.print();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
  });
  def('file.recent', { label: 'Open Recent', enabled: () => true, run() {} });

  // ---------------- Edit ----------------
  def('edit.undo', { label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => hasDoc() && (doc().history.canUndo || app.activeTool.hasPending), run: () => { app.commitTool(); doc().history.undo(); } });
  def('edit.redo', { label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Y', enabled: () => hasDoc() && doc().history.canRedo, run: () => { app.commitTool(); doc().history.redo(); } });
  def('edit.cut', {
    label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X',
    async run() { await C.get('edit.copy').run(); eraseSelection('Cut', 'cut'); },
  });
  def('edit.copy', { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', run: () => copy(false) });
  def('edit.copymerged', { label: 'Copy Merged', icon: 'copymerged', shortcut: 'Ctrl+Shift+C', run: () => copy(true) });
  def('edit.paste', { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', run: async () => { const c = await readClipboard(); if (c) app.pasteCanvas(c.canvas, c.pos); } });
  def('edit.pastelayer', {
    label: 'Paste into New Layer', icon: 'pastelayer', shortcut: 'Ctrl+Shift+V',
    run: async () => { const c = await readClipboard(); if (c) { C.get('layers.add').run(); app.pasteCanvas(c.canvas, c.pos); } },
  });
  def('edit.pasteimage', {
    label: 'Paste into New Image', icon: 'pasteimage', shortcut: 'Ctrl+Alt+V', enabled: () => true,
    run: async () => { const c = await readClipboard(); if (c) app.pasteAsNewImage(c.canvas); },
  });
  def('edit.selectall', {
    label: 'Select All', icon: 'selectall', shortcut: 'Ctrl+A',
    run: () => selectionOp('Select All', 'selectall', (s) => s.selectAll()),
  });
  def('edit.deselect', {
    label: 'Deselect', icon: 'deselect', shortcut: 'Ctrl+D', enabled: hasSel,
    run: () => selectionOp('Deselect', 'deselect', (s) => s.clear()),
  });
  def('edit.erase', { label: 'Erase Selection', icon: 'erasesel', shortcut: 'Delete', run: () => eraseSelection('Erase Selection', 'erasesel') });
  def('edit.fill', {
    label: 'Fill Selection', icon: 'fillsel', shortcut: 'Backspace',
    run() {
      app.commitTool();
      const d = doc(), l = d.activeLayer, before = cloneCanvas(l.canvas), r = d.editBounds;
      const c = l.ctx;
      c.save();
      if (d.selection.empty) { c.fillStyle = toCss(app.primary); c.fillRect(0, 0, d.width, d.height); } else {
        const t = createCanvas(d.width, d.height), tc = t.getContext('2d');
        tc.drawImage(d.selection.mask, 0, 0);
        tc.globalCompositeOperation = 'source-in';
        tc.fillStyle = toCss({ ...app.primary, a: 255 });
        tc.fillRect(0, 0, d.width, d.height);
        c.globalAlpha = app.primary.a / 255;
        c.drawImage(t, 0, 0);
      }
      c.restore();
      d.history.push(pixelItem(d, l, r, before, 'Fill Selection', 'fillsel'));
      d.invalidate(r);
    },
  });
  def('edit.invertsel', {
    label: 'Invert Selection', icon: 'invertsel', shortcut: 'Ctrl+I',
    run: () => selectionOp('Invert Selection', 'invertsel', (s) => s.invert()),
  });
  def('edit.selectallimages', {
    label: 'Select All in All Images', icon: 'selectall', shortcut: 'Ctrl+Alt+A',
    run() { const cur = app.activeDoc; for (const d of app.documents) { app.activeDoc = d; selectionOp('Select All', 'selectall', (s) => s.selectAll()); } app.activeDoc = cur; },
  });
  def('edit.deselectallimages', {
    label: 'Deselect All in All Images', icon: 'deselect', shortcut: 'Ctrl+Alt+D',
    run() { const cur = app.activeDoc; for (const d of app.documents) { app.activeDoc = d; if (!d.selection.empty) selectionOp('Deselect', 'deselect', (s) => s.clear()); } app.activeDoc = cur; },
  });
  def('edit.resetpalette', {
    label: 'Reset Palette to Default', icon: 'colors', enabled: () => true,
    async run() { if (await confirmBox('Reset the color palette to the default colors?')) app.resetPalette(); },
  });

  function selectionOp(name, icon, fn) {
    app.commitTool();
    const d = doc(), before = d.selection.snapshot();
    fn(d.selection);
    d.history.push(selectionItem(d, name, icon, before, d.selection.snapshot()));
    d.emit('selection');
  }

  function eraseSelection(name, icon) {
    app.commitTool();
    const d = doc(), l = d.activeLayer, before = cloneCanvas(l.canvas), r = d.editBounds;
    const c = l.ctx;
    if (d.selection.empty) c.clearRect(0, 0, d.width, d.height);
    else { c.save(); c.globalCompositeOperation = 'destination-out'; c.drawImage(d.selection.mask, 0, 0); c.restore(); }
    const selBefore = d.selection.snapshot();
    d.selection.clear();
    const selAfter = d.selection.snapshot();
    d.history.push(pixelItem(d, l, r, before, name, icon, {
      undo: () => { d.selection.restore(selBefore); d.emit('selection'); },
      redo: () => { d.selection.restore(selAfter); d.emit('selection'); },
    }));
    d.emit('selection');
    d.invalidate(r);
  }

  async function copy(merged) {
    app.commitTool();
    const d = doc(), r = d.editBounds;
    const src = merged ? d.flatten() : d.activeLayer.canvas;
    const c = createCanvas(r.w, r.h), ctx = c.getContext('2d');
    ctx.drawImage(src, -r.x, -r.y);
    if (!d.selection.empty) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(d.selection.mask, -r.x, -r.y); }
    app.clipboard = { canvas: c, pos: { x: r.x, y: r.y }, time: Date.now() };
    app.emit('clipboard');
    try {
      if (navigator.clipboard && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(c) })]);
    } catch (e) { console.warn('System clipboard unavailable, using internal clipboard', e); }
  }

  async function readClipboard() {
    // Prefer the system clipboard; fall back to the internal one.
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find((t) => t.startsWith('image/'));
          if (type) {
            const canvas = await blobToCanvas(await it.getType(type));
            return { canvas, pos: matchInternal(canvas) };
          }
        }
      }
    } catch (e) { /* permission denied or unsupported */ }
    if (app.clipboard) return { canvas: cloneCanvas(app.clipboard.canvas), pos: app.clipboard.pos };
    await messageBox('The clipboard does not contain an image.', { icon: 'info' });
    return null;
  }
  function matchInternal(canvas) {
    const cb = app.clipboard;
    return cb && cb.canvas.width === canvas.width && cb.canvas.height === canvas.height ? cb.pos : null;
  }
  app.matchInternalClipboard = matchInternal;

  // ---------------- View ----------------
  def('view.zoomin', { label: 'Zoom In', icon: 'zoomin', shortcut: 'Ctrl++', run: () => app.view.zoomIn() });
  def('view.zoomout', { label: 'Zoom Out', icon: 'zoomout', shortcut: 'Ctrl+-', run: () => app.view.zoomOut() });
  def('view.fit', { label: 'Zoom to Window', icon: 'zoomfit', shortcut: 'Ctrl+B', run: () => app.view.zoomToFit() });
  def('view.zoomsel', { label: 'Zoom to Selection', icon: 'zoomsel', shortcut: 'Ctrl+Shift+B', enabled: hasSel, run: () => app.view.zoomToRect(doc().selection.bounds) });
  def('view.actual', { label: 'Actual Size', icon: 'zoomactual', shortcut: 'Ctrl+0', run: () => app.view.setZoom(1) });
  def('view.grid', {
    label: 'Pixel Grid', icon: 'grid', shortcut: 'Ctrl+\'', enabled: () => true, checked: () => Settings.get('pixelGrid', false),
    run: () => { Settings.set('pixelGrid', !Settings.get('pixelGrid', false)); app.view.requestRender(); app.emit('settings'); },
  });
  def('view.rulers', {
    label: 'Rulers', icon: 'rulers', shortcut: 'Ctrl+Alt+R', enabled: () => true, checked: () => Settings.get('rulers', false),
    run: () => { const v = !Settings.get('rulers', false); Settings.set('rulers', v); app.view.setRulers(v); app.emit('settings'); },
  });
  for (const [u, l] of [['px', 'Pixels'], ['in', 'Inches'], ['cm', 'Centimeters']]) {
    def('view.units.' + u, { label: l, enabled: () => true, checked: () => Settings.get('units', 'px') === u, run: () => { Settings.set('units', u); app.view.requestRender(); app.emit('settings'); } });
  }
  for (const [w, l, k] of [['tools', 'Tools', 'F5'], ['history', 'History', 'F6'], ['layers', 'Layers', 'F7'], ['colors', 'Colors', 'F8']]) {
    def('window.' + w, { label: l, icon: w, shortcut: k, enabled: () => true, checked: () => app.windows[w]?.visible, run: () => app.windows[w].toggle() });
  }
  def('window.reset', { label: 'Reset Window Positions', enabled: () => true, run: () => app.resetWindows() });
  def('window.next', { label: 'Next Image', shortcut: 'Ctrl+Tab', enabled: () => app.documents.length > 1, run: () => app.cycleDocument(1) });
  def('window.prev', { label: 'Previous Image', shortcut: 'Ctrl+Shift+Tab', enabled: () => app.documents.length > 1, run: () => app.cycleDocument(-1) });

  // ---------------- Image ----------------
  def('image.crop', {
    label: 'Crop to Selection', icon: 'crop', shortcut: 'Ctrl+Shift+X', enabled: hasSel,
    run() {
      app.commitTool();
      const d = doc(), b = d.selection.bounds, mask = cloneCanvas(d.selection.mask);
      const rectSel = isRectSelection(d);
      recordDocOp(d, 'Crop to Selection', 'crop', () => {
        transformLayers(d, b.w, b.h, (c, l) => {
          c.drawImage(l.canvas, -b.x, -b.y);
          if (!rectSel) { c.globalCompositeOperation = 'destination-in'; c.drawImage(mask, -b.x, -b.y); }
        });
        d.selection.resize(b.w, b.h);
        if (!rectSel) d.selection.setFromCanvas(mask, new DOMMatrix([1, 0, 0, 1, -b.x, -b.y]));
      });
      afterGeometry(app, d);
    },
  });
  def('image.resize', {
    label: 'Resize…', icon: 'resize', shortcut: 'Ctrl+R', run: async () => {
      app.commitTool();
      const d = doc();
      const r = await resizeDialog(d);
      if (!r || (r.width === d.width && r.height === d.height && r.dpi === d.dpi)) return;
      const W0 = d.width, H0 = d.height;
      recordDocOp(d, 'Resize Image', 'resize', () => {
        transformLayers(d, r.width, r.height, (c, l) => resample(c, l.canvas, r.width, r.height, r.resampling));
        d.dpi = r.dpi;
        transformSelection(d, r.width, r.height, new DOMMatrix().scale(r.width / W0, r.height / H0));
      });
      afterGeometry(app, d);
    },
  });
  def('image.canvassize', {
    label: 'Canvas Size…', icon: 'canvassize', shortcut: 'Ctrl+Shift+R', run: async () => {
      app.commitTool();
      const d = doc();
      const r = await canvasSizeDialog(d);
      if (!r || (r.width === d.width && r.height === d.height)) return;
      app.resizeCanvas(d, r.width, r.height, r.anchor, 'Canvas Size');
    },
  });
  const flipImg = (name, icon, sx, sy) => () => {
    app.commitTool();
    const d = doc(), W = d.width, H = d.height;
    const m = new DOMMatrix([sx, 0, 0, sy, sx < 0 ? W : 0, sy < 0 ? H : 0]);
    recordDocOp(d, name, icon, () => {
      transformLayers(d, W, H, (c, l) => { c.setTransform(m); c.drawImage(l.canvas, 0, 0); });
      transformSelection(d, W, H, m);
    });
    afterGeometry(app, d);
  };
  def('image.fliph', { label: 'Flip Horizontal', icon: 'fliph', run: flipImg('Flip Image Horizontal', 'fliph', -1, 1) });
  def('image.flipv', { label: 'Flip Vertical', icon: 'flipv', run: flipImg('Flip Image Vertical', 'flipv', 1, -1) });
  const rotImg = (name, icon, deg) => () => {
    app.commitTool();
    const d = doc(), W = d.width, H = d.height;
    const swap = deg % 180 !== 0;
    const nw = swap ? H : W, nh = swap ? W : H;
    const m = new DOMMatrix().translate(nw / 2, nh / 2).rotate(deg).translate(-W / 2, -H / 2);
    recordDocOp(d, name, icon, () => {
      transformLayers(d, nw, nh, (c, l) => { c.setTransform(m); c.drawImage(l.canvas, 0, 0); });
      transformSelection(d, nw, nh, m);
    });
    afterGeometry(app, d);
  };
  def('image.rotcw', { label: 'Rotate 90° Clockwise', icon: 'rotcw', shortcut: 'Ctrl+H', run: rotImg('Rotate 90° Clockwise', 'rotcw', 90) });
  def('image.rotccw', { label: 'Rotate 90° Counter-Clockwise', icon: 'rotccw', shortcut: 'Ctrl+G', run: rotImg('Rotate 90° Counter-Clockwise', 'rotccw', -90) });
  def('image.rot180', { label: 'Rotate 180°', icon: 'rot180', shortcut: 'Ctrl+J', run: rotImg('Rotate 180°', 'rot180', 180) });
  def('image.flatten', {
    label: 'Flatten', icon: 'flatten', shortcut: 'Ctrl+Shift+F', enabled: () => hasDoc() && doc().layers.length > 1,
    run() {
      app.commitTool();
      const d = doc();
      recordDocOp(d, 'Flatten', 'flatten', () => {
        const flat = Layer.fromCanvas(d.flatten(), d.layers[0].name);
        d.layers = [flat];
        d.activeIndex = 0;
      });
      d.emit('layers'); d.invalidate();
    },
  });

  // ---------------- Layers ----------------
  const layerOp = (name, icon, fn) => {
    app.commitTool();
    const d = doc(), before = layersState(d);
    if (fn(d) === false) return;
    d.history.push(layersItem(d, name, icon, before, layersState(d)));
    d.emit('layers');
    d.invalidate();
  };
  app.layerOp = layerOp;
  def('layers.add', {
    label: 'Add New Layer', icon: 'layeradd', shortcut: 'Ctrl+Shift+N',
    run: () => layerOp('Add New Layer', 'layeradd', (d) => {
      const l = new Layer(d.width, d.height, t('Layer {n}', { n: nextLayerNumber(d) }));
      d.layers.splice(d.activeIndex + 1, 0, l);
      d.activeIndex++;
    }),
  });
  def('layers.delete', {
    label: 'Delete Layer', icon: 'layerdelete', shortcut: 'Ctrl+Shift+Delete', enabled: () => hasDoc() && doc().layers.length > 1,
    run: () => layerOp('Delete Layer', 'layerdelete', (d) => { d.layers.splice(d.activeIndex, 1); d.activeIndex = Math.max(0, d.activeIndex - 1); }),
  });
  def('layers.duplicate', {
    label: 'Duplicate Layer', icon: 'layerduplicate', shortcut: 'Ctrl+Shift+D',
    run: () => layerOp('Duplicate Layer', 'layerduplicate', (d) => { const l = d.activeLayer.clone(t('{name} copy', { name: d.activeLayer.name })); d.layers.splice(d.activeIndex + 1, 0, l); d.activeIndex++; }),
  });
  def('layers.merge', {
    label: 'Merge Layer Down', icon: 'layermerge', shortcut: 'Ctrl+M', enabled: () => hasDoc() && doc().activeIndex > 0,
    run: () => layerOp('Merge Layer Down', 'layermerge', (d) => {
      const i = d.activeIndex, upper = d.layers[i], lower = d.layers[i - 1];
      const c = cloneCanvas(lower.canvas);
      const tmpLower = { canvas: lower.canvas, visible: true, opacity: 255, blendMode: 'normal' };
      const tmpUpper = { canvas: upper.canvas, ctx: upper.ctx, visible: upper.visible, opacity: upper.opacity, blendMode: upper.blendMode };
      d.renderComposite(c, undefined, [tmpLower, tmpUpper]);
      lower.canvas = c;
      d.layers.splice(i, 1);
      d.activeIndex = i - 1;
    }),
  });
  def('layers.import', {
    label: 'Import from File…', icon: 'layerimport', run: async () => {
      const files = await pickFiles({ multiple: false });
      if (!files.length) return;
      try {
        const src = await readImageFile(files[0].file);
        const img = src.flatten();
        layerOp('Import from File', 'layerimport', (d) => {
          const l = new Layer(d.width, d.height, files[0].file.name.replace(/\.[^.]+$/, ''));
          l.ctx.drawImage(img, 0, 0);
          d.layers.splice(d.activeIndex + 1, 0, l);
          d.activeIndex++;
        });
      } catch (e) { messageBox(t('Could not import the file.') + '\n\n' + e.message, { icon: 'warning' }); }
    },
  });
  const flipLayer = (name, icon, sx, sy) => () => layerOp(name, icon, (d) => {
    const l = d.activeLayer, c = createCanvas(d.width, d.height), x = c.getContext('2d');
    x.setTransform(sx, 0, 0, sy, sx < 0 ? d.width : 0, sy < 0 ? d.height : 0);
    x.drawImage(l.canvas, 0, 0);
    l.canvas = c;
  });
  def('layers.fliph', { label: 'Flip Horizontal', icon: 'fliph', run: flipLayer('Flip Layer Horizontal', 'fliph', -1, 1) });
  def('layers.flipv', { label: 'Flip Vertical', icon: 'flipv', run: flipLayer('Flip Layer Vertical', 'flipv', 1, -1) });
  def('layers.rotatezoom', {
    label: 'Rotate / Zoom…', icon: 'rotatezoom', shortcut: 'Ctrl+Shift+Z', run: async () => {
      app.commitTool();
      const d = doc(), l = d.activeLayer, before = layersState(d), orig = l.canvas;
      const work = cloneCanvas(orig);
      l.canvas = work;
      const ok = await rotateZoomDialog(app, d, l, orig);
      if (!ok) { l.canvas = orig; d.invalidate(); return; }
      d.history.push(layersItem(d, 'Rotate / Zoom Layer', 'rotatezoom', before, layersState(d)));
      d.invalidate();
    },
  });
  def('layers.properties', {
    label: 'Layer Properties…', icon: 'layerprops', shortcut: 'F4', run: async () => {
      app.commitTool();
      const d = doc(), l = d.activeLayer;
      const r = await layerPropertiesDialog(app, d, l);
      if (!r) return;
      layerOp('Layer Properties', 'layerprops', () => { Object.assign(l, r); });
    },
  });
  def('layers.up', {
    label: 'Move Layer Up', icon: 'layerup', shortcut: 'Alt+PageUp', enabled: () => hasDoc() && doc().activeIndex < doc().layers.length - 1,
    run: () => layerOp('Move Layer Up', 'layerup', (d) => { const i = d.activeIndex; [d.layers[i], d.layers[i + 1]] = [d.layers[i + 1], d.layers[i]]; d.activeIndex++; }),
  });
  def('layers.down', {
    label: 'Move Layer Down', icon: 'layerdown', shortcut: 'Alt+PageDown', enabled: () => hasDoc() && doc().activeIndex > 0,
    run: () => layerOp('Move Layer Down', 'layerdown', (d) => { const i = d.activeIndex; [d.layers[i], d.layers[i - 1]] = [d.layers[i - 1], d.layers[i]]; d.activeIndex--; }),
  });
  def('layers.selectup', { label: 'Select Layer Above', shortcut: 'Alt+ArrowUp', run: () => { doc().setActiveLayer(doc().activeIndex + 1); } });
  def('layers.selectdown', { label: 'Select Layer Below', shortcut: 'Alt+ArrowDown', run: () => { doc().setActiveLayer(doc().activeIndex - 1); } });

  // ---------------- Adjustments & Effects ----------------
  for (const fx of Object.values(EFFECTS)) {
    def('fx.' + fx.id, { label: fx.name + (fx.params ? '…' : ''), icon: fx.icon, shortcut: fx.shortcut, run: () => runEffectCommand(app, fx.id) });
  }
  def('fx.repeat', {
    label: 'Repeat', icon: 'effects', shortcut: 'Ctrl+F', enabled: () => hasDoc() && !!app.lastEffect,
    labelFn: () => (app.lastEffect ? t('Repeat') + ': ' + t(EFFECTS[app.lastEffect].name) : t('Repeat')),
    run: () => runEffectCommand(app, app.lastEffect, { repeat: true }),
  });

  // ---------------- Help / misc ----------------
  def('app.settings', { label: 'Settings…', icon: 'settings', shortcut: 'Ctrl+,', enabled: () => true, run: () => settingsDialog(app) });
  def('app.about', { label: 'About paint.net web', icon: 'info', enabled: () => true, run: () => aboutDialog() });
  def('app.shortcuts', { label: 'Keyboard Shortcuts', icon: 'help', shortcut: 'F1', enabled: () => true, run: () => shortcutsDialog(C) });
  def('app.website', { label: 'paint.net Website', icon: 'app', enabled: () => true, run: () => window.open('https://www.getpaint.net/', '_blank', 'noopener') });

  return C;
}

function nextLayerNumber(d) {
  let n = d.layers.length + 1;
  const names = new Set(d.layers.map((l) => l.name));
  while (names.has(t('Layer {n}', { n }))) n++;
  return n;
}

function isRectSelection(d) {
  const b = d.selection.bounds;
  const data = d.selection.ctx.getImageData(b.x, b.y, b.w, b.h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return false;
  return true;
}

export function resample(ctx, src, w, h, mode) {
  if (mode === 'nearest') {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, w, h);
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = mode === 'bilinear' ? 'low' : mode === 'bicubic' ? 'medium' : 'high';
  // Step down in halves for better quality when shrinking a lot ("supersampling")
  let cur = src, cw = src.width, ch = src.height;
  if (mode === 'best') {
    while (cw / 2 > w && ch / 2 > h) {
      const nw = Math.max(w, Math.floor(cw / 2)), nh = Math.max(h, Math.floor(ch / 2));
      const t = createCanvas(nw, nh), tc = t.getContext('2d');
      tc.imageSmoothingQuality = 'high';
      tc.drawImage(cur, 0, 0, nw, nh);
      cur = t; cw = nw; ch = nh;
    }
  }
  ctx.drawImage(cur, 0, 0, w, h);
}

export { transformLayers, transformSelection, afterGeometry, CANVAS_OPS, Rect, Dialog, listRecent, deserializeDoc };
