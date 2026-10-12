import { iconSvg } from '../icons.js';

// Tiny hyperscript helper: h('div.cls#id', {attrs/on*}, ...children)
export function h(sel, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) children.unshift(attrs);
    attrs = {};
  }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function icon(name, cls = '') {
  const s = document.createElement('span');
  s.className = 'icon ' + cls;
  s.innerHTML = iconSvg(name);
  return s;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// Drag helper using pointer events; calls move(dx, dy, e) and end(e).
export function dragPointer(e, move, end) {
  const sx = e.clientX, sy = e.clientY;
  const target = e.target;
  try { target.setPointerCapture?.(e.pointerId); } catch {}
  const mv = (ev) => move(ev.clientX - sx, ev.clientY - sy, ev);
  const up = (ev) => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    end?.(ev);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

export function shortcutText(s) {
  if (!s) return '';
  return s.replace(/Ctrl/g, 'Ctrl').replace(/\+/g, '+');
}
