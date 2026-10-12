import { Dialog, numberInput, checkbox, selectBox, radioGroup, sliderRow, angleChooser, panChooser } from './dialog.js';
import { h, icon } from './dom.js';
import { BLEND_MODES } from '../document.js';
import { Settings } from '../storage.js';
import { fmtSize, createCanvas } from '../util.js';
import { t, tKeys, LANGUAGES, lang } from '../i18n.js';

const UNIT_LABEL = { in: 'inches', cm: 'centimeters' };

// Width/height editor with aspect lock, pixel + print size, shared by New/Resize/Canvas Size
function sizeEditor({ width, height, dpi, byPercent = false, showPercent = false, onChange }) {
  let w = width, h0 = height, res = dpi, lock = true;
  const ratio = width / height;
  let printUnit = Settings.get('printUnit', 'in');
  const perUnit = () => (printUnit === 'in' ? res : res / 2.54);
  const pw = numberInput({ value: w, min: 1, max: 65535, onInput: (v) => setW(v, 'px') });
  const ph = numberInput({ value: h0, min: 1, max: 65535, onInput: (v) => setH(v, 'px') });
  const rs = numberInput({ value: res, min: 1, max: 9999, decimals: 2, width: 72, onInput: (v) => { res = v; sync('res'); } });
  const iw = numberInput({ value: w / perUnit(), min: 0.01, max: 99999, decimals: 2, width: 72, onInput: (v) => setW(Math.round(v * perUnit()), 'print') });
  const ih = numberInput({ value: h0 / perUnit(), min: 0.01, max: 99999, decimals: 2, width: 72, onInput: (v) => setH(Math.round(v * perUnit()), 'print') });
  const pct = numberInput({ value: 100, min: 1, max: 10000, width: 64, onInput: (v) => { w = Math.max(1, Math.round((width * v) / 100)); h0 = Math.max(1, Math.round((height * v) / 100)); sync('pct'); } });
  const unitSel = selectBox({ options: [['in', 'inches'], ['cm', 'centimeters']], value: printUnit, onChange: (v) => { printUnit = v; Settings.set('printUnit', v); sync(); } });
  const lockBox = checkbox({ label: 'Maintain aspect ratio', checked: true, onChange: (v) => (lock = v) });
  const mode = radioGroup({ options: [['pct', 'By percentage:'], ['abs', 'By absolute size']], value: byPercent ? 'pct' : 'abs', onChange: (v) => { enable(v); } });
  const memo = h('span.size-memo', '');
  function setW(v, src) { w = Math.max(1, v); if (lock) h0 = Math.max(1, Math.round(w / ratio)); sync(src); }
  function setH(v, src) { h0 = Math.max(1, v); if (lock) w = Math.max(1, Math.round(h0 * ratio)); sync(src); }
  function sync(src) {
    if (src !== 'px') { pw.value = w; ph.value = h0; } else { if (lock) { pw.value = w; ph.value = h0; } }
    if (src !== 'print') { iw.value = w / perUnit(); ih.value = h0 / perUnit(); }
    memo.textContent = t('New size: {size}', { size: fmtSize(w * h0 * 4) });
    onChange?.();
  }
  function enable(m) {
    const abs = m !== 'pct';
    for (const c of [pw, ph, rs, iw, ih]) c.input.disabled = !abs;
    lockBox.el.querySelector('input').disabled = !abs;
    pct.input.disabled = abs;
  }
  sync();
  const [modePct, modeAbs] = [...mode.el.children];
  const el = h('div.size-editor',
    showPercent ? h('div.size-mode', h('div.row', modePct, pct.el, ' %'), h('div.row', modeAbs)) : null,
    h('div.row', lockBox.el),
    h('fieldset', h('legend', t('Pixel size')),
      h('div.grid2', h('label', t('Width:')), h('span', pw.el, ' ' + t('pixels')), h('label', t('Height:')), h('span', ph.el, ' ' + t('pixels')))),
    h('fieldset', h('legend', t('Print size')),
      h('div.grid2', h('label', t('Resolution:')), h('span', rs.el, ' ' + t(printUnit === 'in' ? 'pixels/inch' : 'pixels/cm')),
        h('label', t('Width:')), h('span', iw.el, ' ', unitSel.el), h('label', t('Height:')), h('span', ih.el, ' ', t(UNIT_LABEL[printUnit] || '')))),
    memo);
  if (showPercent) enable(mode.value);
  return {
    el,
    get width() { return mode.value === 'pct' && showPercent ? Math.max(1, Math.round((width * pct.value) / 100)) : w; },
    get height() { return mode.value === 'pct' && showPercent ? Math.max(1, Math.round((height * pct.value) / 100)) : h0; },
    get dpi() { return res; },
  };
}

export async function newImageDialog(app) {
  const last = Settings.get('newImageSize', { w: 800, h: 600, dpi: 96 });
  const clipSize = app.clipboard ? { w: app.clipboard.canvas.width, h: app.clipboard.canvas.height } : null;
  const ed = sizeEditor({ width: clipSize?.w || last.w, height: clipSize?.h || last.h, dpi: last.dpi });
  const bg = radioGroup({ options: [['white', 'White'], ['secondary', 'Secondary color'], ['transparent', 'Transparent']], value: Settings.get('newImageBg', 'white') });
  const content = h('div.form', ed.el, h('fieldset', h('legend', t('Background')), bg.el));
  const res = await new Dialog({ title: 'New Image', icon: 'new', content, width: 380 }).show();
  if (res !== 'ok') return null;
  Settings.set('newImageSize', { w: ed.width, h: ed.height, dpi: ed.dpi });
  Settings.set('newImageBg', bg.value);
  return { width: ed.width, height: ed.height, dpi: ed.dpi, background: bg.value };
}

export async function resizeDialog(doc) {
  const ed = sizeEditor({ width: doc.width, height: doc.height, dpi: doc.dpi, showPercent: true });
  const resampling = selectBox({ options: [['best', 'Best Quality'], ['bicubic', 'Bicubic'], ['bilinear', 'Bilinear'], ['nearest', 'Nearest Neighbor']], value: Settings.get('resampling', 'best') });
  const content = h('div.form', h('div.row', h('label', t('Resampling:') + ' '), resampling.el), ed.el);
  const res = await new Dialog({ title: 'Resize Image', icon: 'resize', content, width: 400 }).show();
  if (res !== 'ok') return null;
  Settings.set('resampling', resampling.value);
  return { width: ed.width, height: ed.height, dpi: ed.dpi, resampling: resampling.value };
}

export async function canvasSizeDialog(doc) {
  const ed = sizeEditor({ width: doc.width, height: doc.height, dpi: doc.dpi, showPercent: true });
  let anchor = [0.5, 0.5];
  const cells = [];
  const grid = h('div.anchor-grid');
  const arrows = ['↖', '↑', '↗', '←', '', '→', '↙', '↓', '↘'];
  const draw = () => cells.forEach((c, i) => {
    const ax = (i % 3) / 2, ay = Math.floor(i / 3) / 2;
    c.classList.toggle('sel', ax === anchor[0] && ay === anchor[1]);
    const dx = Math.round(((i % 3) - anchor[0] * 2)), dy = Math.round((Math.floor(i / 3) - anchor[1] * 2));
    c.textContent = dx === 0 && dy === 0 ? '' : Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? arrows[(dy + 1) * 3 + dx + 1] : '';
  });
  for (let i = 0; i < 9; i++) {
    const c = h('button.anchor-cell', { onclick: () => { anchor = [(i % 3) / 2, Math.floor(i / 3) / 2]; draw(); } });
    cells.push(c); grid.appendChild(c);
  }
  draw();
  const content = h('div.form', ed.el, h('fieldset', h('legend', t('Anchor')), grid));
  const res = await new Dialog({ title: 'Canvas Size', icon: 'canvassize', content, width: 400 }).show();
  if (res !== 'ok') return null;
  return { width: ed.width, height: ed.height, dpi: ed.dpi, anchor };
}

export async function layerPropertiesDialog(app, doc, layer) {
  const orig = { name: layer.name, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode };
  const preview = () => { doc.invalidate(); app.emit('layers'); };
  const name = h('input.text', { type: 'text', value: layer.name, oninput: (e) => { layer.name = e.target.value; app.emit('layers'); } });
  const vis = checkbox({ label: 'Visible', checked: layer.visible, onChange: (v) => { layer.visible = v; preview(); } });
  const blend = selectBox({ options: BLEND_MODES, value: layer.blendMode, onChange: (v) => { layer.blendMode = v; preview(); } });
  const op = sliderRow({ label: 'Opacity', value: layer.opacity, min: 0, max: 255, def: 255, onInput: (v) => { layer.opacity = v; preview(); } });
  const content = h('div.form',
    h('fieldset', h('legend', t('General')), h('div.grid2', h('label', t('Name:')), name), vis.el),
    h('fieldset', h('legend', t('Blending')), h('div.grid2', h('label', t('Mode:')), blend.el), op.el));
  const res = await new Dialog({ title: 'Layer Properties', icon: 'layerprops', content, width: 380 }).show();
  const now = { name: layer.name, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode };
  Object.assign(layer, orig);
  if (res !== 'ok') { preview(); return null; }
  return now;
}

export async function rotateZoomDialog(app, doc, layer, before) {
  let angle = 0, pan = { x: 0, y: 0 }, zoom = 1;
  const W = doc.width, H = doc.height;
  const apply = () => {
    const c = layer.ctx;
    c.save();
    c.clearRect(0, 0, W, H);
    c.translate(W / 2 + (pan.x * W) / 2, H / 2 + (pan.y * H) / 2);
    c.rotate((-angle * Math.PI) / 180);
    c.scale(zoom, zoom);
    c.imageSmoothingQuality = 'high';
    c.drawImage(before, -W / 2, -H / 2);
    c.restore();
    doc.invalidate();
  };
  const thumb = (() => { const s = Math.min(1, 140 / Math.max(W, H)); const c = createCanvas(W * s, H * s); c.getContext('2d').drawImage(before, 0, 0, c.width, c.height); return c; })();
  const content = h('div.fx-props',
    angleChooser({ label: 'Angle', value: 0, onInput: (v) => { angle = v; apply(); } }).el,
    panChooser({ label: 'Pan', value: pan, onInput: (v) => { pan = v; apply(); }, thumb }).el,
    sliderRow({ label: 'Zoom', value: 1, min: 0.05, max: 16, step: 0.01, decimals: 2, def: 1, log: true, onInput: (v) => { zoom = v; apply(); } }).el);
  const res = await new Dialog({ title: 'Rotate / Zoom Layer', icon: 'rotatezoom', content, width: 380 }).show();
  return res === 'ok';
}

export async function pasteTooLargeDialog() {
  return new Dialog({
    title: 'Paste', icon: 'paste', width: 440,
    content: h('div.msgbox', h('div.msgbox-icon', icon('warning')), h('div.msgbox-text', t('The image being pasted is larger than the canvas size. What would you like to do?'))),
    buttons: [{ label: 'Expand canvas', value: 'expand', primary: true }, { label: 'Keep canvas size', value: 'keep' }, { label: 'Cancel', value: 'cancel', cancel: true }],
  }).show();
}

export async function settingsDialog(app) {
  const theme = radioGroup({ options: [['system', 'Use system setting'], ['light', 'Light'], ['dark', 'Dark']], value: Settings.get('theme', 'system'), onChange: (v) => { Settings.set('theme', v); app.applyTheme(); } });
  const translucent = checkbox({ label: 'Translucent windows when inactive', checked: Settings.get('translucent', true), onChange: (v) => { Settings.set('translucent', v); app.applyTheme(); } });
  const autosave = checkbox({ label: 'Remember open images between sessions (stored in this browser)', checked: Settings.get('autosave', true), onChange: (v) => Settings.set('autosave', v) });
  const accent = selectBox({
    options: [['#0067c0', 'Blue'], ['#7a43b6', 'Purple'], ['#c42b1c', 'Red'], ['#ca5010', 'Orange'], ['#107c10', 'Green'], ['#5d5a58', 'Graphite']],
    value: Settings.get('accent', '#0067c0'), onChange: (v) => { Settings.set('accent', v); app.applyTheme(); },
  });
  const reloadBtn = h('button.btn', { style: { display: 'none' }, onclick: () => { Settings._save.flush(); location.reload(); } }, t('Reload now'));
  const language = selectBox({
    options: LANGUAGES, value: Settings.get('language', 'auto'),
    onChange: (v) => { Settings.set('language', v); reloadBtn.style.display = ''; },
  });
  const clearBtn = h('button.btn', { onclick: async () => { await app.clearStoredData(); clearBtn.textContent = t('Cleared'); clearBtn.disabled = true; } }, t('Clear stored images and recent files'));
  const resetBtn = h('button.btn', { onclick: () => { app.resetSettings(); resetBtn.textContent = t('Settings reset'); resetBtn.disabled = true; } }, t('Reset all settings'));
  const content = h('div.form.settings',
    h('fieldset', h('legend', t('Language')), h('div.row', language.el, reloadBtn), h('div.hint', t('The new language is applied after reloading the page.'))),
    h('fieldset', h('legend', t('Appearance')), h('div', t('Theme:')), theme.el, h('div.row', h('label', t('Accent color:') + ' '), accent.el), translucent.el),
    h('fieldset', h('legend', t('Storage')), autosave.el, h('div.row', clearBtn), h('div.row', resetBtn)));
  await new Dialog({ title: 'Settings', icon: 'settings', content, width: 440, buttons: [{ label: 'Close', value: 'ok', primary: true, cancel: true }] }).show();
}

export async function aboutDialog() {
  const content = h('div.about',
    h('div.about-logo', icon('app')),
    h('div',
      h('h2', 'paint.net', h('span.about-web', ' web')),
      h('p', t('A browser recreation of the paint.net image editor, running entirely on your device. Images are kept in your browser (IndexedDB); settings in localStorage.')),
      h('p.hint', t('paint.net is a trademark of dotPDN LLC. This is an independent, unofficial project and is not affiliated with or endorsed by dotPDN LLC.')),
      h('p', h('a', { href: 'https://www.getpaint.net/', target: '_blank', rel: 'noopener' }, t('Get the original paint.net for Windows')))));
  await new Dialog({ title: 'About', icon: 'info', content, width: 460, buttons: [{ label: 'Close', value: 'ok', primary: true, cancel: true }] }).show();
}

export async function shortcutsDialog(commands) {
  const rows = [...commands.values()].filter((c) => c.shortcut).map((c) => h('tr', h('td', t(c.label.replace(/…$/, ''))), h('td.kbd', tKeys(c.shortcut))));
  const tools = [['Move Selected Pixels / Move Selection', 'M'], ['Selection tools', 'S'], ['Zoom', 'Z'], ['Pan', 'H (or hold Space)'], ['Paint Bucket', 'F'], ['Gradient', 'G'], ['Paintbrush', 'B'], ['Eraser', 'E'], ['Pencil', 'P'], ['Color Picker', 'K'], ['Clone Stamp', 'L'], ['Recolor', 'R'], ['Text', 'T'], ['Line/Curve, Shapes', 'O'], ['Swap colors', 'X'], ['Brush width', '[ and ]']];
  const content = h('div.shortcuts', h('table', h('tbody', rows, tools.map(([a, b]) => h('tr', h('td', t(a)), h('td.kbd', t(b)))))));
  await new Dialog({ title: 'Keyboard Shortcuts', icon: 'help', content, width: 460, buttons: [{ label: 'Close', value: 'ok', primary: true, cancel: true }] }).show();
}
