import { h, icon, clear, dragPointer } from './dom.js';
import { showPopup, closeAllMenus } from './menubar.js';
import { clamp } from '../util.js';
import { SHAPES } from '../tools/shapes.js';
import { BLEND_MODES } from '../document.js';

const BRUSH_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 450, 500, 600, 700, 800, 900, 1000];
const FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Palatino Linotype', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'system-ui', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72, 96, 144, 192, 288];

// Icon-choice dropdown: shows the current option's icon/label, opens a popup list
function choiceButton(app, { title, options, get, set, iconFn, labelFn, showLabel = false }) {
  const btn = h('button.opt-btn.dropdown-btn', { title });
  const render = () => {
    clear(btn);
    const v = get();
    const opt = options.find((o) => o[0] === v) || options[0];
    if (iconFn) btn.appendChild(iconFn(opt[0]));
    if (showLabel || !iconFn) btn.appendChild(h('span.opt-label', labelFn ? labelFn(opt) : opt[1]));
    btn.appendChild(icon('chevdown', 'opt-chev'));
  };
  btn.addEventListener('click', () => {
    closeAllMenus();
    const r = btn.getBoundingClientRect();
    btn.classList.add('open');
    const m = showPopup(app, options.map((o) => ({ label: o[1], icon: iconFn ? null : undefined, iconEl: iconFn?.(o[0]), checked: () => get() === o[0], run: () => { set(o[0]); render(); } })), r.left, r.bottom, () => btn.classList.remove('open'));
    // add icons
    requestAnimationFrame(() => {
      if (!iconFn) return;
      [...m.el.querySelectorAll('.menu-item')].forEach((row, i) => {
        const slot = row.querySelector('.mi-icon');
        if (slot && !slot.firstChild) slot.appendChild(iconFn(options[i][0]));
      });
    });
  });
  render();
  return { el: btn, render };
}

function toggleBtn(title, ic, get, set) {
  const b = h('button.opt-btn.toggle', { title, onclick: () => { set(!get()); upd(); } }, typeof ic === 'string' ? icon(ic) : ic);
  const upd = () => b.classList.toggle('active', !!get());
  upd();
  return { el: b, render: upd };
}

// Editable numeric combo box with preset dropdown
function numberCombo(app, { title, get, set, presets, min, max, width = 52, suffix = '' }) {
  const inp = h('input.combo-input', { type: 'text', title, style: { width: width + 'px' } });
  const commit = () => { const v = parseFloat(inp.value); if (!isNaN(v)) set(clamp(Math.round(v), min, max)); inp.value = get() + suffix; };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { commit(); inp.blur(); } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(clamp(get() + (e.key === 'ArrowUp' ? 1 : -1), min, max)); inp.value = get() + suffix; } });
  const drop = h('button.combo-drop.dropdown-btn', { title }, icon('chevdown'));
  drop.addEventListener('click', () => {
    closeAllMenus();
    const r = inp.getBoundingClientRect();
    drop.classList.add('open');
    showPopup(app, presets.map((v) => ({ label: String(v), checked: () => get() === v, run: () => { set(v); inp.value = get() + suffix; } })), r.left, r.bottom, () => drop.classList.remove('open'));
  });
  const render = () => { if (document.activeElement !== inp) inp.value = get() + suffix; };
  render();
  return { el: h('span.combo', inp, drop), render };
}

// Bar slider like paint.net's tolerance / hardness slider
function barSlider({ label, get, set, min = 0, max = 100, fmt = (v) => Math.round(v) + '%' }) {
  const fill = h('div.bar-fill');
  const text = h('div.bar-text');
  const bar = h('div.bar-slider', { title: label }, fill, text);
  const render = () => {
    const v = get();
    fill.style.width = ((v - min) / (max - min)) * 100 + '%';
    text.textContent = `${label}: ${fmt(v)}`;
  };
  const fromEv = (e) => {
    const r = bar.getBoundingClientRect();
    set(min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min));
    render();
  };
  bar.addEventListener('pointerdown', (e) => { fromEv(e); dragPointer(e, (dx, dy, ev) => fromEv(ev)); });
  bar.addEventListener('wheel', (e) => { e.preventDefault(); set(clamp(get() + (e.deltaY < 0 ? 1 : -1) * (max - min) / 100, min, max)); render(); }, { passive: false });
  render();
  return { el: bar, render };
}

function aaIcon(on) {
  const s = h('span.icon');
  s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 13L13 3" stroke="currentColor" stroke-width="${on ? 2.4 : 2}" ${on ? '' : 'shape-rendering="crispEdges"'} fill="none"/></svg>`;
  return s;
}
function textIcon(t, style) { const s = h('span.icon.txt-icon', { style }); s.textContent = t; return s; }
function shapeIcon(type) {
  const s = h('span.icon');
  const P = {
    rectangle: '<rect x="2" y="3.5" width="12" height="9" />', roundrect: '<rect x="2" y="3.5" width="12" height="9" rx="2.5"/>',
    ellipse: '<ellipse cx="8" cy="8" rx="6" ry="4.5"/>', diamond: '<path d="M8 2l6 6-6 6-6-6z"/>', triangle: '<path d="M8 2.5l6 11H2z"/>',
    righttriangle: '<path d="M2.5 2.5v11h11z"/>', pentagon: '<path d="M8 2l6 4.4-2.3 7.1H4.3L2 6.4z"/>', hexagon: '<path d="M2 8l3-5.2h6L14 8l-3 5.2H5z"/>',
    octagon: '<path d="M5.5 2h5L14 5.5v5L10.5 14h-5L2 10.5v-5z"/>', star5: '<path d="M8 1.5l1.9 4.4 4.6.3-3.5 3 1.1 4.6L8 11.3l-4.1 2.5L5 9.2l-3.5-3 4.6-.3z"/>',
    star6: '<path d="M8 1.5l2 3.5h4l-2 3 2 3h-4l-2 3.5-2-3.5H2l2-3-2-3h4z"/>', plus: '<path d="M6 2h4v4h4v4h-4v4H6v-4H2V6h4z"/>',
    arrowright: '<path d="M2 5.5h7V2.5L14 8l-5 5.5v-3H2z"/>', heart: '<path d="M8 14S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 8-6 8z"/>',
    callout: '<path d="M2 2.5h12v8H7l-3 3v-3H2z"/>',
  };
  s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">${P[type] || P.rectangle}</svg>`;
  return s;
}
function drawModeIcon(m) {
  const s = h('span.icon');
  const fill = m === 'outline' ? 'none' : m === 'fill' ? 'currentColor' : '#9ec5f8';
  s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="3.5" width="11" height="9" fill="${fill}" stroke="${m === 'fill' ? 'none' : 'currentColor'}" stroke-width="1.4"/></svg>`;
  return s;
}
function dashIcon(d) {
  const s = h('span.icon.dash-icon');
  const da = { solid: '', dash: '6 2', dot: '2 2', dashdot: '6 2 2 2', dashdotdot: '6 2 2 2 2 2' }[d];
  s.innerHTML = `<svg viewBox="0 0 32 16" width="32" height="16"><path d="M1 8h30" stroke="currentColor" stroke-width="2" stroke-dasharray="${da}"/></svg>`;
  return s;
}
function arrowIcon(a) {
  const s = h('span.icon.dash-icon');
  const L = a === 'start' || a === 'both', R = a === 'end' || a === 'both';
  s.innerHTML = `<svg viewBox="0 0 32 16" width="32" height="16"><path d="M${L ? 6 : 2} 8h${R ? 20 - (L ? 4 : 0) : 28 - (L ? 4 : 0)}" stroke="currentColor" stroke-width="2"/>${L ? '<path d="M1 8l7-4v8z" fill="currentColor"/>' : ''}${R ? '<path d="M31 8l-7-4v8z" fill="currentColor"/>' : ''}</svg>`;
  return s;
}
function selModeIcon(m) {
  const s = h('span.icon');
  const shapes = {
    replace: '<rect x="3" y="3" width="10" height="10" fill="#9ec5f8" stroke="currentColor" stroke-dasharray="2 1.5"/>',
    union: '<rect x="1.5" y="1.5" width="8" height="8" fill="#9ec5f8" stroke="currentColor"/><rect x="6.5" y="6.5" width="8" height="8" fill="#9ec5f8" stroke="currentColor"/><rect x="6.5" y="6.5" width="3" height="3" fill="#9ec5f8"/>',
    exclude: '<rect x="1.5" y="1.5" width="8" height="8" fill="#9ec5f8" stroke="currentColor"/><rect x="6.5" y="6.5" width="8" height="8" fill="var(--panel)" stroke="currentColor"/>',
    intersect: '<rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor"/><rect x="6.5" y="6.5" width="8" height="8" fill="none" stroke="currentColor"/><rect x="6.5" y="6.5" width="3" height="3" fill="#2f7bd8"/>',
    xor: '<rect x="1.5" y="1.5" width="8" height="8" fill="#9ec5f8" stroke="currentColor"/><rect x="6.5" y="6.5" width="8" height="8" fill="#9ec5f8" stroke="currentColor"/><rect x="7" y="7" width="2" height="2" fill="var(--panel)"/>',
  };
  s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16">${shapes[m]}</svg>`;
  return s;
}

export class ToolOptionsBar {
  constructor(app, host) {
    this.app = app;
    this.toolBtn = h('button.opt-btn.tool-select.dropdown-btn', { title: 'Tool' });
    this.toolBtn.addEventListener('click', () => {
      closeAllMenus();
      const r = this.toolBtn.getBoundingClientRect();
      this.toolBtn.classList.add('open');
      showPopup(app, [...app.tools.values()].map((t) => ({ label: t.name, icon: t.icon, shortcut: t.key, checked: () => false, run: () => app.setTool(t.id) })), r.left, r.bottom, () => this.toolBtn.classList.remove('open'));
    });
    this.opts = h('div.tooloptions-items');
    this.el = h('div.tooloptions', h('span.opt-caption', 'Tool:'), this.toolBtn, h('div.tb-sep'), this.opts);
    host.appendChild(this.el);
    this.widgets = [];
    app.on('tool', () => this.build());
    app.on('toolsettings', () => this.widgets.forEach((w) => w.render?.()));
    this.build();
  }
  widget(key) {
    const app = this.app, S = app.toolSettings;
    const get = (k) => () => S[k];
    const set = (k) => (v) => app.setToolSetting(k, v);
    const cap = (t) => h('span.opt-caption', t);
    switch (key) {
      case 'brushWidth': {
        const c = numberCombo(app, { title: 'Brush width', get: get('brushWidth'), set: set('brushWidth'), presets: BRUSH_SIZES, min: 1, max: 2000 });
        return { el: h('span.opt-group', cap('Brush width:'), c.el), render: c.render };
      }
      case 'hardness': {
        const b = barSlider({ label: 'Hardness', get: get('hardness'), set: (v) => app.setToolSetting('hardness', Math.round(v)) });
        return b;
      }
      case 'antialias':
        return choiceButton(app, { title: 'Antialiasing', options: [[true, 'Antialiasing Enabled'], [false, 'Antialiasing Disabled']], get: get('antialias'), set: set('antialias'), iconFn: aaIcon });
      case 'blendMode':
        return choiceButton(app, {
          title: 'Blend mode', options: [['normal', 'Normal'], ['overwrite', 'Overwrite'], ...BLEND_MODES.filter(([k]) => k !== 'normal')],
          get: get('blendMode'), set: set('blendMode'), labelFn: (o) => o[1],
        });
      case 'selectionMode':
        return { el: h('span.opt-group', cap('Selection mode:'), choiceButton(app, {
          title: 'Selection mode', options: [['replace', 'Replace'], ['union', 'Add (union)'], ['exclude', 'Subtract'], ['intersect', 'Intersect'], ['xor', 'Invert (xor)']],
          get: get('selectionMode'), set: set('selectionMode'), iconFn: selModeIcon,
        }).el) };
      case 'floodMode':
        return { el: h('span.opt-group', cap('Flood mode:'), choiceButton(app, { title: 'Flood mode', options: [['contiguous', 'Contiguous'], ['global', 'Global']], get: get('floodMode'), set: set('floodMode'), showLabel: true }).el) };
      case 'tolerance':
        return barSlider({ label: 'Tolerance', get: () => S.tolerance * 100, set: (v) => app.setToolSetting('tolerance', Math.round(v) / 100) });
      case 'sampling':
        return { el: h('span.opt-group', cap('Sampling:'), choiceButton(app, { title: 'Sampling', options: [['layer', 'Layer'], ['image', 'Image']], get: get('sampling'), set: set('sampling'), showLabel: true }).el) };
      case 'font': {
        const sel = h('select.select.font-select', { title: 'Font' }, FONTS.map((f) => h('option', { value: f, style: { fontFamily: f } }, f)));
        sel.addEventListener('change', () => app.setToolSetting('font', sel.value));
        sel.addEventListener('keydown', (e) => e.stopPropagation());
        const render = () => { sel.value = S.font; };
        render();
        return { el: h('span.opt-group', cap('Font:'), sel), render };
      }
      case 'fontSize': {
        const c = numberCombo(app, { title: 'Font size', get: get('fontSize'), set: set('fontSize'), presets: FONT_SIZES, min: 1, max: 2000, width: 40 });
        return c;
      }
      case 'fontStyle': {
        const st = (k) => () => S.fontStyle[k];
        const sv = (k) => (v) => app.setToolSetting('fontStyle', { ...S.fontStyle, [k]: v });
        const ws = [
          toggleBtn('Bold', textIcon('B', { fontWeight: 700 }), st('bold'), sv('bold')),
          toggleBtn('Italic', textIcon('I', { fontStyle: 'italic', fontFamily: 'Georgia,serif' }), st('italic'), sv('italic')),
          toggleBtn('Underline', textIcon('U', { textDecoration: 'underline' }), st('underline'), sv('underline')),
          toggleBtn('Strikethrough', textIcon('S', { textDecoration: 'line-through' }), st('strike'), sv('strike')),
        ];
        return { el: h('span.opt-group', ws.map((w) => w.el)), render: () => ws.forEach((w) => w.render()) };
      }
      case 'textAlign': {
        const al = (a) => { const s = h('span.icon'); const L = { left: [2, 2, 2, 2], center: [3, 5, 3, 5], right: [4, 8, 4, 8] }[a]; s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" stroke-width="1.4"><path d="M${L[0]} 3h${14 - L[0] - (a === 'center' ? L[0] - 2 : a === 'left' ? 0 : 0)}M${L[1]} 6.5h${a === 'left' ? 8 : a === 'center' ? 6 : 6}M${L[2]} 10h${a === 'center' ? 10 : 10}M${L[3]} 13.5h${6}" /></svg>`; return s; };
        const ws = ['left', 'center', 'right'].map((a) => toggleBtn('Align ' + a, al(a), () => S.textAlign === a, () => app.setToolSetting('textAlign', a)));
        return { el: h('span.opt-group', ws.map((w) => w.el)), render: () => ws.forEach((w) => w.render()) };
      }
      case 'pickerSampling':
        return { el: h('span.opt-group', cap('Sampling:'), choiceButton(app, {
          title: 'Sampling', options: [[1, 'Single pixel'], [3, '3 x 3 region'], [5, '5 x 5 region'], [7, '7 x 7 region'], [9, '9 x 9 region'], [11, '11 x 11 region'], [51, '51 x 51 region']],
          get: get('pickerSampling'), set: set('pickerSampling'), showLabel: true,
        }).el, choiceButton(app, { title: 'Sample', options: [['layer', 'Layer'], ['image', 'Image']], get: get('pickerSource'), set: set('pickerSource'), showLabel: true }).el) };
      case 'pickerSource': return null;
      case 'pickerAfter':
        return { el: h('span.opt-group', cap('After clicking:'), choiceButton(app, {
          title: 'After clicking', options: [['none', 'Do not switch tool'], ['previous', 'Switch to previous tool'], ['pencil', 'Switch to Pencil tool']],
          get: get('pickerAfter'), set: set('pickerAfter'), showLabel: true,
        }).el) };
      case 'gradientType': {
        const gi = (t) => {
          const s = h('span.icon');
          const body = {
            linear: '<defs><linearGradient id="gl" x1="0" x2="1"><stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect x="1.5" y="1.5" width="13" height="13" fill="url(#gl)" stroke="currentColor"/>',
            reflected: '<defs><linearGradient id="gr" x1="0" x2="1"><stop stop-color="#fff"/><stop offset=".5" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect x="1.5" y="1.5" width="13" height="13" fill="url(#gr)" stroke="currentColor"/>',
            diamond: '<rect x="1.5" y="1.5" width="13" height="13" fill="#fff" stroke="currentColor"/><path d="M8 2l6 6-6 6-6-6z" fill="#777"/><path d="M8 5l3 3-3 3-3-3z" fill="#000"/>',
            radial: '<defs><radialGradient id="grr"><stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient></defs><rect x="1.5" y="1.5" width="13" height="13" fill="url(#grr)" stroke="currentColor"/>',
            conical: '<rect x="1.5" y="1.5" width="13" height="13" fill="#fff" stroke="currentColor"/><path d="M8 8L14.5 1.5V14.5z" fill="#000"/><path d="M8 8L14.5 1.5H4z" fill="#666"/><path d="M8 8L14.5 14.5H4z" fill="#666"/>',
            spiralcw: '<rect x="1.5" y="1.5" width="13" height="13" fill="#fff" stroke="currentColor"/><path d="M8 8a1.5 1.5 0 0 1 3 0 3 3 0 0 1-6 0 4.5 4.5 0 0 1 9 0" fill="none" stroke="#000" stroke-width="1.5"/>',
            spiralccw: '<rect x="1.5" y="1.5" width="13" height="13" fill="#fff" stroke="currentColor"/><path d="M8 8a1.5 1.5 0 0 0-3 0 3 3 0 0 0 6 0 4.5 4.5 0 0 0-9 0" fill="none" stroke="#000" stroke-width="1.5"/>',
          }[t];
          s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16">${body}</svg>`;
          return s;
        };
        const opts = [['linear', 'Linear'], ['reflected', 'Linear (Reflected)'], ['diamond', 'Linear (Diamond)'], ['radial', 'Radial'], ['conical', 'Conical'], ['spiralcw', 'Spiral (Clockwise)'], ['spiralccw', 'Spiral (Counter-clockwise)']];
        const ws = opts.map(([v, l]) => toggleBtn(l, gi(v), () => S.gradientType === v, () => app.setToolSetting('gradientType', v)));
        return { el: h('span.opt-group', cap('Gradient:'), ws.map((w) => w.el)), render: () => ws.forEach((w) => w.render()) };
      }
      case 'gradientMode':
        return { el: h('span.opt-group', cap('Mode:'), choiceButton(app, { title: 'Color mode', options: [['color', 'Color Mode'], ['transparency', 'Transparency Mode']], get: get('gradientMode'), set: set('gradientMode'), showLabel: true }).el) };
      case 'shapeType':
        return { el: h('span.opt-group', cap('Shape:'), choiceButton(app, { title: 'Shape type', options: SHAPES, get: get('shapeType'), set: set('shapeType'), iconFn: shapeIcon }).el) };
      case 'shapeDraw':
        return { el: h('span.opt-group', cap('Fill:'), choiceButton(app, { title: 'Draw type', options: [['outline', 'Draw Shape Outline'], ['fill', 'Draw Filled Shape'], ['both', 'Draw Filled Shape With Outline']], get: get('shapeDraw'), set: set('shapeDraw'), iconFn: drawModeIcon }).el) };
      case 'lineStyle':
        return { el: h('span.opt-group', cap('Dash:'), choiceButton(app, { title: 'Dash style', options: [['solid', 'Solid'], ['dash', 'Dash'], ['dot', 'Dot'], ['dashdot', 'Dash-Dot'], ['dashdotdot', 'Dash-Dot-Dot']], get: get('lineStyle'), set: set('lineStyle'), iconFn: dashIcon }).el) };
      case 'arrows':
        return { el: h('span.opt-group', cap('Arrows:'), choiceButton(app, { title: 'Arrow heads', options: [['none', 'None'], ['start', 'Start'], ['end', 'End'], ['both', 'Both']], get: get('arrows'), set: set('arrows'), iconFn: arrowIcon }).el) };
      case 'moveQuality':
        return { el: h('span.opt-group', cap('Quality:'), choiceButton(app, { title: 'Resampling', options: [['bilinear', 'Bilinear'], ['nearest', 'Nearest Neighbor']], get: get('moveQuality'), set: set('moveQuality'), showLabel: true }).el) };
    }
    return null;
  }
  build() {
    const t = this.app.activeTool;
    clear(this.toolBtn);
    this.toolBtn.append(icon(t.icon), icon('chevdown', 'opt-chev'));
    this.toolBtn.title = t.name;
    clear(this.opts);
    this.widgets = [];
    t.options.forEach((key, i) => {
      const w = this.widget(key);
      if (!w) return;
      if (this.widgets.length) this.opts.appendChild(h('div.tb-sep'));
      this.widgets.push(w);
      this.opts.appendChild(w.el);
    });
  }
}
