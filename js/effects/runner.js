import { EFFECTS, defaultParams, runEffect, curveLut, histogramLevels } from './registry.js';
import { Dialog, sliderRow, angleChooser, panChooser, checkbox, selectBox, numberInput } from '../ui/dialog.js';
import { h, icon, dragPointer } from '../ui/dom.js';
import { cloneCanvas, createCanvas, debounce, clamp } from '../util.js';
import { pixelItem } from '../history.js';

let worker = null, workerOk = true, msgId = 0;
const pending = new Map();

function getWorker() {
  if (!workerOk) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(new Uint8ClampedArray(e.data.data));
      };
      worker.onerror = () => { workerOk = false; worker = null; for (const p of pending.values()) p.fallback(); pending.clear(); };
      worker._hasSrc = null;
    } catch { workerOk = false; return null; }
  }
  return worker;
}

function killWorker() {
  if (worker) { worker.terminate(); worker = null; }
  for (const p of pending.values()) p.reject(new Error('cancelled'));
  pending.clear();
}

// Run an effect, in a worker when possible. job = {effect, srcData(ImageData), rect, params, env, srcKey}
function render(job) {
  const inline = () => runEffect(job.effect, job.srcData, job.rect, job.params, job.env).data;
  const w = getWorker();
  if (!w) return Promise.resolve(inline());
  if (pending.size) { killWorker(); return render(job); }
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject, fallback: () => { try { resolve(inline()); } catch (e) { reject(e); } } });
    const msg = { id, effect: job.effect, rect: job.rect, params: job.params, env: job.env };
    if (w._hasSrc !== job.srcKey) {
      msg.src = job.srcData.data.slice().buffer;
      msg.width = job.srcData.width; msg.height = job.srcData.height;
      w._hasSrc = job.srcKey;
      w.postMessage(msg, [msg.src]);
    } else w.postMessage(msg);
  });
}

let srcCounter = 0;
const lastParams = {};

export async function runEffectCommand(app, id, { repeat = false } = {}) {
  const fx = EFFECTS[id];
  const doc = app.activeDoc;
  if (!fx || !doc) return;
  app.commitTool();
  const layer = doc.activeLayer;
  const W = doc.width, H = doc.height;
  const rect = doc.editBounds;
  const before = cloneCanvas(layer.canvas);
  const srcData = before.getContext('2d').getImageData(0, 0, W, H);
  const clip = doc.selection.clip;
  const env = { primary: { ...app.primary }, secondary: { ...app.secondary }, sel: { ...rect } };
  const srcKey = ++srcCounter;
  const tmp = clip ? createCanvas(W, H) : null;

  const apply = (data) => {
    const img = new ImageData(data, W, H);
    const L = layer.ctx;
    if (!clip) {
      L.putImageData(img, 0, 0, rect.x, rect.y, rect.w, rect.h);
    } else {
      const T = tmp.getContext('2d');
      T.clearRect(0, 0, W, H);
      T.putImageData(img, 0, 0, rect.x, rect.y, rect.w, rect.h);
      T.globalCompositeOperation = 'destination-in';
      T.drawImage(clip, 0, 0);
      T.globalCompositeOperation = 'source-over';
      L.save();
      L.beginPath(); L.rect(rect.x, rect.y, rect.w, rect.h); L.clip();
      L.clearRect(rect.x, rect.y, rect.w, rect.h);
      L.drawImage(before, 0, 0);
      L.globalCompositeOperation = 'destination-out';
      L.drawImage(clip, 0, 0);
      L.globalCompositeOperation = 'lighter';
      L.drawImage(tmp, 0, 0);
      L.restore();
    }
    doc.invalidate(rect);
  };
  const restore = () => {
    const L = layer.ctx;
    L.clearRect(rect.x, rect.y, rect.w, rect.h);
    L.drawImage(before, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
    doc.invalidate(rect);
  };
  const finish = () => {
    doc.history.push(pixelItem(doc, layer, rect, before, fx.name, fx.icon));
    app.lastEffect = id;
    app.emit('lasteffect');
  };

  const hasParams = fx.params && fx.params.length;
  if (!hasParams || repeat) {
    const params = repeat && lastParams[id] ? lastParams[id] : defaultParams(fx);
    app.setBusy(true);
    try {
      apply(await render({ effect: id, srcData, rect, params, env, srcKey }));
      finish();
    } catch (e) { console.error(e); restore(); } finally { app.setBusy(false); }
    return;
  }

  const params = lastParams[id] ? JSON.parse(JSON.stringify(lastParams[id])) : defaultParams(fx);
  let rendering = null, dirty = true, latest = null;
  const status = h('span.fx-status', '');
  const doRender = async () => {
    dirty = false;
    status.textContent = 'Rendering…';
    const p = JSON.parse(JSON.stringify(params));
    const job = render({ effect: id, srcData, rect, params: p, env, srcKey });
    rendering = job;
    try {
      const data = await job;
      if (rendering !== job) return;
      latest = data;
      apply(data);
      status.textContent = '';
    } catch (e) { if (e.message !== 'cancelled') { console.error(e); status.textContent = 'Error'; } }
    finally { if (rendering === job) rendering = null; }
  };
  const schedule = debounce(() => doRender(), 60);
  const changed = () => { dirty = true; schedule(); };

  const thumb = (() => { const s = Math.min(1, 160 / Math.max(W, H)); const c = createCanvas(W * s, H * s); c.getContext('2d').drawImage(before, 0, 0, c.width, c.height); return c; })();
  const controls = [];
  for (const pd of fx.params) {
    const set = (v) => { params[pd.key] = v; changed(); };
    switch (pd.type) {
      case 'int': case 'float':
        controls.push(sliderRow({ label: pd.label, value: params[pd.key], min: pd.min, max: pd.max, step: pd.step || 1, decimals: pd.decimals || 0, def: pd.def, onInput: set }).el); break;
      case 'angle': controls.push(angleChooser({ label: pd.label, value: params[pd.key], def: pd.def, onInput: set }).el); break;
      case 'bool': controls.push(h('div.prop-row', checkbox({ label: pd.label, checked: params[pd.key], onChange: set }).el)); break;
      case 'choice': controls.push(h('div.prop-row', h('div.prop-label', pd.label), selectBox({ options: pd.options, value: params[pd.key], onChange: set }).el)); break;
      case 'pan': controls.push(panChooser({ label: pd.label, value: params[pd.key], def: pd.def, onInput: set, thumb }).el); break;
      case 'seed': {
        const lbl = h('span', '');
        controls.push(h('div.prop-row', h('div.prop-label', pd.label), h('div.prop-ctl', h('button.btn', { onclick: () => { params[pd.key] = Math.floor(Math.random() * 1e9); changed(); } }, 'Reseed'), lbl)));
        break;
      }
      case 'curves': controls.push(curvesEditor(params[pd.key], changed, srcData, rect)); break;
      case 'levels': controls.push(levelsEditor(params[pd.key], changed, srcData, rect)); break;
    }
  }
  const dlg = new Dialog({
    title: fx.name, icon: fx.icon, width: fx.params.some((p) => p.type === 'curves' || p.type === 'levels') ? 520 : 380,
    content: h('div.fx-props', controls),
    className: 'fx-dialog',
  });
  dlg.el.querySelector('.dlg-buttons').prepend(status);
  doRender();
  const res = await dlg.show();
  if (res === 'ok') {
    app.setBusy(true);
    try {
      if (dirty || rendering) { schedule.cancel(); await doRender(); }
      if (latest) apply(latest);
      lastParams[id] = JSON.parse(JSON.stringify(params));
      finish();
    } finally { app.setBusy(false); }
  } else {
    schedule.cancel();
    rendering = null;
    killWorker();
    restore();
  }
}

// ---------- Curves editor ----------
function curvesEditor(state, changed, srcData, rect) {
  const SZ = 256;
  const cv = h('canvas.curves-canvas', { width: SZ, height: SZ });
  const channels = { r: true, g: true, b: true };
  const modeSel = selectBox({ options: [['luminosity', 'Luminosity'], ['rgb', 'RGB']], value: state.mode, onChange: (v) => { state.mode = v; chk.style.display = v === 'rgb' ? '' : 'none'; draw(); changed(); } });
  const chk = h('div.curves-ch',
    ['r', 'g', 'b'].map((k) => checkbox({ label: { r: 'Red', g: 'Green', b: 'Blue' }[k], checked: true, onChange: (v) => { channels[k] = v; draw(); } }).el));
  chk.style.display = state.mode === 'rgb' ? '' : 'none';
  const { hr, hg, hb } = histogramLevels(srcData, rect);
  const editKeys = () => (state.mode === 'luminosity' ? ['l'] : ['r', 'g', 'b'].filter((k) => channels[k]));
  const colors = { l: '#333', r: '#e5484d', g: '#3fa652', b: '#2f7bd8' };
  const draw = () => {
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, SZ, SZ);
    // histogram
    let mx = 1; for (let i = 0; i < 256; i++) mx = Math.max(mx, hr[i] + hg[i] + hb[i]);
    c.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 256; i++) { const v = ((hr[i] + hg[i] + hb[i]) / mx) * SZ; c.fillRect(i, SZ - v, 1, v); }
    c.strokeStyle = '#ddd'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < 4; i++) { c.moveTo(i * 64 + 0.5, 0); c.lineTo(i * 64 + 0.5, SZ); c.moveTo(0, i * 64 + 0.5); c.lineTo(SZ, i * 64 + 0.5); }
    c.stroke();
    c.strokeStyle = '#bbb'; c.beginPath(); c.moveTo(0, SZ); c.lineTo(SZ, 0); c.stroke();
    const keys = state.mode === 'luminosity' ? ['l'] : ['r', 'g', 'b'];
    for (const k of keys) {
      const lut = curveLut(state[k]);
      c.strokeStyle = colors[k]; c.lineWidth = 1.5;
      c.beginPath();
      for (let x = 0; x < 256; x++) { const y = SZ - 1 - lut[x]; x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      if (editKeys().includes(k)) for (const [px, py] of state[k]) {
        c.fillStyle = '#fff'; c.strokeStyle = colors[k];
        c.beginPath(); c.arc(px, SZ - 1 - py, 4, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    }
  };
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect();
    const toPt = (ev) => [clamp(Math.round(((ev.clientX - r.left) / r.width) * 255), 0, 255), clamp(Math.round(255 - ((ev.clientY - r.top) / r.height) * 255), 0, 255)];
    const [x, y] = toPt(e);
    const keys = editKeys();
    if (!keys.length) return;
    // find existing point near x on first key
    const pts0 = state[keys[0]];
    let idx = pts0.findIndex(([px, py]) => Math.abs(px - x) < 8 && Math.abs(py - y) < 12);
    if (idx < 0) {
      for (const k of keys) { state[k].push([x, y]); state[k].sort((a, b) => a[0] - b[0]); }
      idx = state[keys[0]].findIndex(([px]) => px === x);
    }
    const startX = state[keys[0]][idx][0];
    draw(); changed();
    dragPointer(e, (dx, dy, ev) => {
      const [nx, ny] = toPt(ev);
      for (const k of keys) {
        const pts = state[k];
        const j = pts.findIndex(([px]) => px === startX);
        const i2 = j >= 0 ? j : Math.min(idx, pts.length - 1);
        const prev = pts[i2 - 1], next = pts[i2 + 1];
        const lo = prev ? prev[0] + 1 : 0, hi = next ? next[0] - 1 : 255;
        pts[i2] = [clamp(nx, lo, hi), ny];
      }
      draw(); changed();
    }, (ev) => {
      // Dragging far outside removes a middle point
      const rr = cv.getBoundingClientRect();
      if (ev.clientX < rr.left - 20 || ev.clientX > rr.right + 20 || ev.clientY < rr.top - 20 || ev.clientY > rr.bottom + 20) {
        for (const k of keys) if (state[k].length > 2) state[k].splice(idx, 1);
        draw(); changed();
      }
    });
  });
  const reset = h('button.btn', { onclick: () => { for (const k of ['l', 'r', 'g', 'b']) state[k] = [[0, 0], [255, 255]]; draw(); changed(); } }, 'Reset');
  requestAnimationFrame(draw);
  return h('div.curves-editor',
    h('div.prop-row', h('div.prop-label', 'Transfer map'), h('div.prop-ctl', modeSel.el, chk)),
    cv,
    h('div.curves-foot', h('span.hint', 'Click to add a point, drag a point outside to remove it.'), reset));
}

// ---------- Levels editor ----------
function levelsEditor(L, changed, srcData, rect) {
  const { hr, hg, hb } = histogramLevels(srcData, rect);
  const hist = h('canvas.levels-hist', { width: 256, height: 100 });
  const draw = () => {
    const c = hist.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, 256, 100);
    let mx = 1; for (let i = 0; i < 256; i++) mx = Math.max(mx, hr[i], hg[i], hb[i]);
    c.globalCompositeOperation = 'multiply';
    for (const [hh, col, on] of [[hr, '#ff7070', L.r], [hg, '#70d080', L.g], [hb, '#70a0ff', L.b]]) {
      if (!on) continue;
      c.fillStyle = col;
      for (let i = 0; i < 256; i++) { const v = (hh[i] / mx) * 100; c.fillRect(i, 100 - v, 1, v); }
    }
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.fillRect(0, 0, L.inLo, 100); c.fillRect(L.inHi, 0, 256 - L.inHi, 100);
  };
  const upd = () => { draw(); changed(); };
  const inLo = numberInput({ value: L.inLo, min: 0, max: 254, onInput: (v) => { L.inLo = Math.min(v, L.inHi - 1); upd(); } });
  const inHi = numberInput({ value: L.inHi, min: 1, max: 255, onInput: (v) => { L.inHi = Math.max(v, L.inLo + 1); upd(); } });
  const gamma = numberInput({ value: L.gamma, min: 0.1, max: 10, step: 0.1, decimals: 2, onInput: (v) => { L.gamma = v; upd(); } });
  const outLo = numberInput({ value: L.outLo, min: 0, max: 255, onInput: (v) => { L.outLo = v; upd(); } });
  const outHi = numberInput({ value: L.outHi, min: 0, max: 255, onInput: (v) => { L.outHi = v; upd(); } });
  const sync = () => { inLo.value = L.inLo; inHi.value = L.inHi; gamma.value = L.gamma; outLo.value = L.outLo; outHi.value = L.outHi; };
  const auto = h('button.btn', { onclick: () => {
    let total = 0; for (let i = 0; i < 256; i++) total += hr[i];
    const cut = total * 0.005; let lo = 0, hi = 255, acc = 0;
    const lum = (i) => (hr[i] + hg[i] + hb[i]) / 3;
    for (; lo < 255; lo++) { acc += lum(lo); if (acc > cut) break; }
    acc = 0; for (; hi > 0; hi--) { acc += lum(hi); if (acc > cut) break; }
    Object.assign(L, { inLo: lo, inHi: Math.max(lo + 1, hi), gamma: 1 }); sync(); upd();
  } }, 'Auto');
  const reset = h('button.btn', { onclick: () => { Object.assign(L, { inLo: 0, inHi: 255, gamma: 1, outLo: 0, outHi: 255 }); sync(); upd(); } }, 'Reset');
  const chans = ['r', 'g', 'b'].map((k) => checkbox({ label: { r: 'R', g: 'G', b: 'B' }[k], checked: L[k], onChange: (v) => { L[k] = v; upd(); } }).el);
  requestAnimationFrame(draw);
  return h('div.levels-editor',
    h('div.levels-grid',
      h('div.levels-col', h('div.prop-label', 'Input'), h('label', 'White ', inHi.el), h('label', 'Black ', inLo.el)),
      h('div.levels-mid', hist, h('label.levels-gamma', 'Gamma ', gamma.el)),
      h('div.levels-col', h('div.prop-label', 'Output'), h('label', 'White ', outHi.el), h('label', 'Black ', outLo.el))),
    h('div.curves-foot', h('div.levels-ch', chans), h('span', auto, ' ', reset)));
}
