import { Dialog, numberInput } from './dialog.js';
import { h, dragPointer } from './dom.js';
import { rgbToHsv, hsvToRgb, toHex, fromHex, toCss } from '../color.js';
import { clamp } from '../util.js';
import { t } from '../i18n.js';

function gradSlider({ min, max, onInput }) {
  const thumb = h('div.gs-thumb');
  const track = h('div.gs-track', h('div.gs-checker'), h('div.gs-grad'), thumb);
  let val = min;
  const set = (v, fire) => {
    val = clamp(v, min, max);
    thumb.style.left = ((val - min) / (max - min)) * 100 + '%';
    if (fire) onInput(val);
  };
  const fromEv = (e) => { const r = track.getBoundingClientRect(); set(Math.round(min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min)), true); };
  track.addEventListener('pointerdown', (e) => { fromEv(e); dragPointer(e, (dx, dy, ev) => fromEv(ev)); });
  return { el: track, set: (v) => set(v, false), setGradient: (g) => (track.querySelector('.gs-grad').style.background = g) };
}

export async function colorDialog(app, which) {
  const orig = { primary: { ...app.primary }, secondary: { ...app.secondary } };
  const cur = { primary: { ...app.primary }, secondary: { ...app.secondary } };
  let mode = which;
  let c = cur[mode];
  let hsv = rgbToHsv(c.r, c.g, c.b);

  const SZ = 196;
  const wheel = h('canvas.color-wheel', { width: SZ, height: SZ });
  const wheelMark = h('div.wheel-mark');
  const wheelWrap = h('div.wheel-wrap', wheel, wheelMark);
  let wheelV = -1;
  const drawWheel = () => {
    if (wheelV === Math.round(hsv.v)) return;
    wheelV = Math.round(hsv.v);
    const ctx = wheel.getContext('2d'), img = ctx.createImageData(SZ, SZ), d = img.data, R = SZ / 2;
    for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
      const dx = x + 0.5 - R, dy = y + 0.5 - R, r = Math.hypot(dx, dy);
      const i = (y * SZ + x) * 4;
      if (r > R) continue;
      const hue = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
      const rgb = hsvToRgb(hue, Math.min(1, r / (R - 1)) * 100, hsv.v);
      d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b; d[i + 3] = clamp((R - r) * 255, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
  };
  const fromWheel = (e) => {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    hsv.h = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
    hsv.s = clamp(Math.hypot(dx, dy) / (r.width / 2), 0, 1) * 100;
    if (hsv.v === 0) hsv.v = 100;
    fromHsv();
  };
  wheel.addEventListener('pointerdown', (e) => { fromWheel(e); dragPointer(e, (dx, dy, ev) => fromWheel(ev)); });

  const rows = {};
  const mkRow = (key, label, max) => {
    const gs = gradSlider({ min: 0, max, onInput: (v) => onChannel(key, v) });
    const num = numberInput({ value: 0, min: 0, max, width: 56, onInput: (v) => onChannel(key, v) });
    rows[key] = { gs, num };
    return h('div.cd-row', h('label', t(label)), gs.el, num.el);
  };
  const hex = h('input.text.hex-input', { type: 'text', maxlength: 9, spellcheck: false });
  const applyHex = () => { const v = fromHex(hex.value); if (v) { Object.assign(c, v); hsv = rgbToHsv(c.r, c.g, c.b); sync(); } };
  hex.addEventListener('change', applyHex);
  hex.addEventListener('input', () => { if (/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex.value.trim())) applyHex(); });
  hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hex.dispatchEvent(new Event('change')); } });

  const oldSw = h('div.cd-sw.old', { title: t('Original color — click to restore'), onclick: () => { Object.assign(c, orig[mode]); hsv = rgbToHsv(c.r, c.g, c.b); sync(); } });
  const newSw = h('div.cd-sw.new', { title: t('New color') });
  const btnP = h('button.seg-btn', { onclick: () => switchMode('primary') }, t('Primary'));
  const btnS = h('button.seg-btn', { onclick: () => switchMode('secondary') }, t('Secondary'));
  const switchMode = (m) => { mode = m; c = cur[mode]; hsv = rgbToHsv(c.r, c.g, c.b); sync(); };

  function onChannel(key, v) {
    if ('hsv'.includes(key)) { hsv[key] = v; fromHsv(); return; }
    c[{ r: 'r', g: 'g', b: 'b', a: 'a' }[key]] = Math.round(v);
    if (key !== 'a') { const n = rgbToHsv(c.r, c.g, c.b); hsv = { h: n.s ? n.h : hsv.h, s: n.s, v: n.v }; }
    sync();
  }
  function fromHsv() {
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    c.r = rgb.r; c.g = rgb.g; c.b = rgb.b;
    sync();
  }
  function sync() {
    drawWheel();
    const R = SZ / 2;
    const a = (hsv.h * Math.PI) / 180, rr = (hsv.s / 100) * (R - 1);
    wheelMark.style.left = R + Math.cos(a) * rr + 'px';
    wheelMark.style.top = R - Math.sin(a) * rr + 'px';
    const vals = { h: Math.round(hsv.h), s: Math.round(hsv.s), v: Math.round(hsv.v), r: c.r, g: c.g, b: c.b, a: c.a };
    for (const [k, { gs, num }] of Object.entries(rows)) { gs.set(vals[k]); num.value = vals[k]; }
    const { r, g, b } = c;
    const hueStops = [0, 60, 120, 180, 240, 300, 360].map((d) => toCss({ ...hsvToRgb(d, Math.max(hsv.s, 1) > 0 ? 100 : 0, 100), a: 255 })).join(',');
    rows.h.gs.setGradient(`linear-gradient(to right, ${hueStops})`);
    rows.s.gs.setGradient(`linear-gradient(to right, ${toCss({ ...hsvToRgb(hsv.h, 0, hsv.v), a: 255 })}, ${toCss({ ...hsvToRgb(hsv.h, 100, hsv.v), a: 255 })})`);
    rows.v.gs.setGradient(`linear-gradient(to right, #000, ${toCss({ ...hsvToRgb(hsv.h, hsv.s, 100), a: 255 })})`);
    rows.r.gs.setGradient(`linear-gradient(to right, rgb(0,${g},${b}), rgb(255,${g},${b}))`);
    rows.g.gs.setGradient(`linear-gradient(to right, rgb(${r},0,${b}), rgb(${r},255,${b}))`);
    rows.b.gs.setGradient(`linear-gradient(to right, rgb(${r},${g},0), rgb(${r},${g},255))`);
    rows.a.gs.setGradient(`linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))`);
    if (document.activeElement !== hex) hex.value = toHex(c, true);
    oldSw.style.setProperty('--c', toCss(orig[mode]));
    newSw.style.setProperty('--c', toCss(c));
    btnP.classList.toggle('active', mode === 'primary');
    btnS.classList.toggle('active', mode === 'secondary');
  }

  const content = h('div.color-dialog',
    h('div.cd-top', h('div.seg', btnP, btnS), h('div.cd-compare', oldSw, newSw)),
    h('div.cd-main',
      wheelWrap,
      h('div.cd-sliders',
        h('div.cd-group', h('div.cd-group-title', 'RGB'), mkRow('r', 'Red', 255), mkRow('g', 'Green', 255), mkRow('b', 'Blue', 255)),
        h('div.cd-group', h('div.cd-group-title', 'HSV'), mkRow('h', 'Hue', 360), mkRow('s', 'Saturation', 100), mkRow('v', 'Value', 100)),
        h('div.cd-group', mkRow('a', 'Opacity', 255), h('div.cd-row', h('label', t('Hex')), hex)))));
  sync();
  const dlg = new Dialog({ title: 'Colors', icon: 'colors', content, width: 560, className: 'color-dlg' });
  const res = await dlg.show();
  if (res === 'ok') {
    app.setPrimary(cur.primary);
    app.setSecondary(cur.secondary);
  }
}
