import { h, icon, dragPointer } from './dom.js';
import { clamp } from '../util.js';

const stack = [];
export const openDialogCount = () => stack.length;

export class Dialog {
  constructor({ title, icon: ic, content, buttons, width, className, onKey }) {
    this.buttons = buttons || [{ label: 'OK', value: 'ok', primary: true }, { label: 'Cancel', value: 'cancel', cancel: true }];
    this.onKey = onKey;
    this.btnEls = {};
    const titleBar = h('div.dlg-title',
      ic ? icon(ic) : null,
      h('span.dlg-title-text', title || ''),
      h('button.dlg-close', { title: 'Close', onclick: () => this.close(this._cancelValue()) }, icon('close')),
    );
    this.body = h('div.dlg-body', content);
    const btnRow = h('div.dlg-buttons', this.buttons.map((b) => {
      const el = h('button.btn' + (b.primary ? '.primary' : ''), { onclick: () => this.close(b.value) }, b.label);
      this.btnEls[b.value] = el;
      return el;
    }));
    this.el = h('div.dialog' + (className ? '.' + className : ''), { role: 'dialog', style: width ? { width: width + 'px' } : null }, titleBar, this.body, this.buttons.length ? btnRow : null);
    this.backdrop = h('div.modal-backdrop', this.el);
    titleBar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dlg-close')) return;
      const r = this.el.getBoundingClientRect();
      dragPointer(e, (dx, dy) => {
        this.el.style.left = clamp(r.left + dx, -r.width + 60, innerWidth - 60) + 'px';
        this.el.style.top = clamp(r.top + dy, 0, innerHeight - 30) + 'px';
        this.el.style.transform = 'none';
      });
    });
    this._keydown = (e) => {
      if (stack[stack.length - 1] !== this) return;
      if (this.onKey && this.onKey(e)) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(this._cancelValue()); }
      else if (e.key === 'Enter' && !e.shiftKey && !/TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) {
        const p = this.buttons.find((b) => b.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); this.close(p.value); }
      }
    };
  }
  _cancelValue() { return (this.buttons.find((b) => b.cancel) || { value: 'cancel' }).value; }
  setEnabled(value, enabled) { if (this.btnEls[value]) this.btnEls[value].disabled = !enabled; }
  show() {
    document.body.appendChild(this.backdrop);
    stack.push(this);
    window.addEventListener('keydown', this._keydown, true);
    const r = this.el.getBoundingClientRect();
    this.el.style.left = Math.max(0, (innerWidth - r.width) / 2) + 'px';
    this.el.style.top = Math.max(0, (innerHeight - r.height) / 2.4) + 'px';
    const focusable = this.body.querySelector('input:not([type=range]):not([type=checkbox]), select, textarea') || this.el.querySelector('.btn.primary');
    setTimeout(() => { focusable?.focus(); focusable?.select?.(); }, 0);
    return new Promise((res) => { this._resolve = res; });
  }
  close(value) {
    if (this.beforeClose && this.beforeClose(value) === false) return;
    window.removeEventListener('keydown', this._keydown, true);
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    this.backdrop.remove();
    this._resolve?.(value);
  }
}

// ---------- Controls ----------
export function numberInput({ value = 0, min = -Infinity, max = Infinity, step = 1, decimals = 0, width = 64, onInput, suffix }) {
  const inp = h('input.num', { type: 'number', value: fmt(value, decimals), min, max, step, style: { width: width + 'px' } });
  const ctl = {
    el: suffix ? h('span.num-wrap', inp, h('span.num-suffix', suffix)) : inp,
    input: inp,
    get value() { return clamp(parseFloat(inp.value) || 0, min, max); },
    set value(v) { inp.value = fmt(v, decimals); },
  };
  inp.addEventListener('input', () => { if (inp.value !== '' && !isNaN(parseFloat(inp.value))) onInput?.(ctl.value); });
  inp.addEventListener('change', () => { inp.value = fmt(ctl.value, decimals); onInput?.(ctl.value); });
  return ctl;
}
const fmt = (v, d) => (d ? (+v).toFixed(d) : String(Math.round(v)));

// paint.net style property row: caption, slider, spin box, reset button
export function sliderRow({ label, value, min, max, step = 1, decimals = 0, def, onInput, log = false }) {
  def = def ?? value;
  const toS = (v) => (log ? Math.log(v) : v), fromS = (s) => (log ? Math.exp(s) : s);
  const slider = h('input.slider', { type: 'range', min: toS(min), max: toS(max), step: log ? 'any' : step, value: toS(value) });
  let cur = value;
  const set = (v, fire) => {
    cur = clamp(+(+v).toFixed(decimals), min, max);
    slider.value = toS(cur);
    num.value = cur;
    if (fire) onInput?.(cur);
  };
  const num = numberInput({ value, min, max, step, decimals, onInput: (v) => set(v, true) });
  slider.addEventListener('input', () => set(fromS(+slider.value), true));
  const reset = h('button.reset-btn', { title: 'Reset', onclick: () => set(def, true) }, icon('reset'));
  const el = h('div.prop-row', label ? h('div.prop-label', label) : null, h('div.prop-ctl', slider, num.el, reset));
  return { el, get value() { return cur; }, set value(v) { set(v, false); } };
}

export function checkbox({ label, checked = false, onChange }) {
  const inp = h('input', { type: 'checkbox', checked });
  inp.addEventListener('change', () => onChange?.(inp.checked));
  const el = h('label.check', inp, h('span', label));
  return { el, get value() { return inp.checked; }, set value(v) { inp.checked = v; } };
}

export function selectBox({ options, value, onChange, width }) {
  const sel = h('select.select', { style: width ? { width: width + 'px' } : null },
    options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  sel.addEventListener('change', () => onChange?.(sel.value));
  return { el: sel, get value() { return sel.value; }, set value(v) { sel.value = v; } };
}

export function radioGroup({ options, value, onChange, name = 'r' + Math.random().toString(36).slice(2) }) {
  let cur = value;
  const inputs = [];
  const el = h('div.radio-group', options.map(([v, l]) => {
    const inp = h('input', { type: 'radio', name, value: v, checked: v === value });
    inputs.push(inp);
    inp.addEventListener('change', () => { if (inp.checked) { cur = v; onChange?.(v); } });
    return h('label.check', inp, h('span', l));
  }));
  return { el, get value() { return cur; }, set value(v) { cur = v; inputs.forEach((i) => (i.checked = i.value === String(v))); } };
}

// Circular angle chooser (degrees, -180..180)
export function angleChooser({ label, value = 0, def, onInput }) {
  def = def ?? value;
  const cv = h('canvas.angle-dial', { width: 56, height: 56 });
  let cur = value;
  const draw = () => {
    const c = cv.getContext('2d'), r = 25;
    c.clearRect(0, 0, 56, 56);
    c.strokeStyle = getComputedStyle(cv).color;
    c.lineWidth = 1;
    c.beginPath(); c.arc(28, 28, r, 0, Math.PI * 2); c.stroke();
    const a = (-cur * Math.PI) / 180;
    c.strokeStyle = '#2f7bd8'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(28, 28); c.lineTo(28 + Math.cos(a) * r, 28 + Math.sin(a) * r); c.stroke();
    c.fillStyle = '#2f7bd8'; c.beginPath(); c.arc(28, 28, 2.5, 0, Math.PI * 2); c.fill();
  };
  const set = (v, fire) => {
    v = ((((v + 180) % 360) + 360) % 360) - 180;
    cur = +v.toFixed(2);
    num.value = cur;
    draw();
    if (fire) onInput?.(cur);
  };
  const num = numberInput({ value, min: -180, max: 180, step: 1, decimals: 2, width: 72, onInput: (v) => set(v, true) });
  const fromPointer = (e) => {
    const r = cv.getBoundingClientRect();
    let a = (-Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180) / Math.PI;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    set(a, true);
  };
  cv.addEventListener('pointerdown', (e) => { fromPointer(e); dragPointer(e, (dx, dy, ev) => fromPointer(ev)); });
  const reset = h('button.reset-btn', { title: 'Reset', onclick: () => set(def, true) }, icon('reset'));
  const el = h('div.prop-row', label ? h('div.prop-label', label) : null, h('div.prop-ctl.angle-ctl', cv, num.el, reset));
  requestAnimationFrame(draw);
  return { el, get value() { return cur; }, set value(v) { set(v, false); } };
}

// Pan/offset chooser: value {x,y} in -1..1 (relative to center)
export function panChooser({ label, value = { x: 0, y: 0 }, def, onInput, thumb }) {
  def = def ?? { ...value };
  const W = 120, H = thumb ? Math.max(40, Math.round((120 * thumb.height) / thumb.width)) : 80;
  const cv = h('canvas.pan-pad', { width: W, height: Math.min(H, 120) });
  let cur = { ...value };
  const draw = () => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    if (thumb) c.drawImage(thumb, 0, 0, cv.width, cv.height);
    else { c.fillStyle = '#888'; c.fillRect(0, 0, cv.width, cv.height); }
    const x = ((cur.x + 1) / 2) * cv.width, y = ((cur.y + 1) / 2) * cv.height;
    c.strokeStyle = '#fff'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x - 8, y); c.lineTo(x + 8, y); c.moveTo(x, y - 8); c.lineTo(x, y + 8); c.stroke();
    c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
  };
  const set = (v, fire) => {
    cur = { x: clamp(v.x, -2, 2), y: clamp(v.y, -2, 2) };
    nx.value = cur.x; ny.value = cur.y;
    draw();
    if (fire) onInput?.({ ...cur });
  };
  const nx = numberInput({ value: cur.x, min: -2, max: 2, step: 0.01, decimals: 2, onInput: (v) => set({ x: v, y: cur.y }, true) });
  const ny = numberInput({ value: cur.y, min: -2, max: 2, step: 0.01, decimals: 2, onInput: (v) => set({ x: cur.x, y: v }, true) });
  const fromPointer = (e) => {
    const r = cv.getBoundingClientRect();
    set({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 }, true);
  };
  cv.addEventListener('pointerdown', (e) => { fromPointer(e); dragPointer(e, (dx, dy, ev) => fromPointer(ev)); });
  const reset = h('button.reset-btn', { title: 'Reset', onclick: () => set(def, true) }, icon('reset'));
  const el = h('div.prop-row', label ? h('div.prop-label', label) : null,
    h('div.prop-ctl.pan-ctl', cv, h('div.pan-nums', h('label', 'X ', nx.el), h('label', 'Y ', ny.el)), reset));
  requestAnimationFrame(draw);
  return { el, get value() { return { ...cur }; }, set value(v) { set(v, false); } };
}

// ---------- Message boxes ----------
export function messageBox(text, { title = 'paint.net', icon: ic = 'info', buttons } = {}) {
  const content = h('div.msgbox', h('div.msgbox-icon', icon(ic)), h('div.msgbox-text', text));
  return new Dialog({ title, content, buttons: buttons || [{ label: 'OK', value: 'ok', primary: true, cancel: true }], width: 420 }).show();
}

export function confirmBox(text, opts = {}) {
  return messageBox(text, {
    icon: 'warning',
    buttons: [{ label: opts.yes || 'OK', value: true, primary: true }, { label: opts.no || 'Cancel', value: false, cancel: true }],
    ...opts,
  });
}

export function promptBox(text, value = '', title = 'paint.net') {
  const inp = h('input.text', { type: 'text', value, style: { width: '100%' } });
  const d = new Dialog({ title, content: h('div.form', h('div', text), inp), width: 360 });
  return d.show().then((r) => (r === 'ok' ? inp.value : null));
}
