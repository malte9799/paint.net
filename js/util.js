// General helpers shared across the app.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function cloneCanvas(src) {
  const c = createCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

export function cropCanvas(src, r) {
  const c = createCanvas(r.w, r.h);
  c.getContext('2d').drawImage(src, -r.x, -r.y);
  return c;
}

export class Emitter {
  constructor() { this._ev = new Map(); }
  on(name, fn) {
    if (!this._ev.has(name)) this._ev.set(name, new Set());
    this._ev.get(name).add(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) { this._ev.get(name)?.delete(fn); }
  emit(name, ...args) {
    const set = this._ev.get(name);
    if (set) for (const fn of [...set]) fn(...args);
  }
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function throttleRaf(fn) {
  let pending = false, args;
  return (...a) => {
    args = a;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...args); });
  };
}

// Rectangles are {x, y, w, h}
export const Rect = {
  make: (x, y, w, h) => ({ x, y, w, h }),
  fromPoints(x0, y0, x1, y1) {
    const x = Math.min(x0, x1), y = Math.min(y0, y1);
    return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  },
  union(a, b) {
    if (!a || Rect.isEmpty(a)) return b ? { ...b } : null;
    if (!b || Rect.isEmpty(b)) return { ...a };
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  },
  intersect(a, b) {
    if (!a || !b) return null;
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
    if (r <= x || btm <= y) return null;
    return { x, y, w: r - x, h: btm - y };
  },
  isEmpty: (r) => !r || r.w <= 0 || r.h <= 0,
  inflate: (r, n) => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n }),
  // Integer bounds fully covering r
  outer(r) {
    const x = Math.floor(r.x), y = Math.floor(r.y);
    return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
  },
  clip(r, w, h) { return Rect.intersect(Rect.outer(r), { x: 0, y: 0, w, h }); },
  contains: (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h,
};

let _uid = 1;
export const uid = () => _uid++;

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), type, quality));
}

export async function blobToCanvas(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch (e) {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Unsupported image format')); };
      img.src = url;
    });
  }
  const c = createCanvas(bmp.width || bmp.naturalWidth, bmp.height || bmp.naturalHeight);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function fileExt(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function stripExt(name) { return (name || '').replace(/\.[^.]+$/, ''); }

// Deterministic PRNG (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export function dist(x0, y0, x1, y1) { return Math.hypot(x1 - x0, y1 - y0); }

// Snap the vector (dx,dy) to the closest multiple of 15 degrees (used with Shift)
export function snapAngle(x0, y0, x1, y1, stepDeg = 15) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / step) * step;
  return { x: x0 + Math.cos(a) * d, y: y0 + Math.sin(a) * d };
}
