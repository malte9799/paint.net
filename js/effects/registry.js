// Adjustments and effects. Pure functions (no DOM) so they can run inside a Web Worker.
// render(src, dst, rect, params, env): src/dst are ImageData-like {data, width, height};
// only pixels inside rect need to be written. env: {primary, secondary, sel: {x,y,w,h}}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Apply per-pixel fn(r,g,b,a) → [r,g,b,a] within rect
function perPixel(src, dst, rect, fn) {
  const W = src.width, s = src.data, d = dst.data;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    let i = (y * W + rect.x) * 4;
    for (let x = 0; x < rect.w; x++, i += 4) {
      const o = fn(s[i], s[i + 1], s[i + 2], s[i + 3]);
      d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o[3];
    }
  }
}

function lutApply(src, dst, rect, lr, lg, lb) {
  const W = src.width, s = src.data, d = dst.data;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    let i = (y * W + rect.x) * 4;
    for (let x = 0; x < rect.w; x++, i += 4) {
      d[i] = lr[s[i]]; d[i + 1] = lg[s[i + 1]]; d[i + 2] = lb[s[i + 2]]; d[i + 3] = s[i + 3];
    }
  }
}

// Bilinear sample with edge clamping, writes into out[0..3]
function sample(src, x, y, out) {
  const W = src.width, H = src.height, s = src.data;
  x = clamp(x - 0.5, 0, W - 1); y = clamp(y - 0.5, 0, H - 1);
  const x0 = x | 0, y0 = y | 0, x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const a00 = s[i00 + 3] * w00, a10 = s[i10 + 3] * w10, a01 = s[i01 + 3] * w01, a11 = s[i11 + 3] * w11;
  const a = a00 + a10 + a01 + a11;
  if (a <= 0) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
  for (let k = 0; k < 3; k++) out[k] = (s[i00 + k] * a00 + s[i10 + k] * a10 + s[i01 + k] * a01 + s[i11 + k] * a11) / a;
  out[3] = a;
  return out;
}

function nearest(src, x, y, out) {
  const W = src.width, H = src.height;
  const xi = clamp(Math.floor(x), 0, W - 1), yi = clamp(Math.floor(y), 0, H - 1);
  const i = (yi * W + xi) * 4, s = src.data;
  out[0] = s[i]; out[1] = s[i + 1]; out[2] = s[i + 2]; out[3] = s[i + 3];
  return out;
}

// Generic displacement: map(x,y) → [sx,sy] (pixel centers), supersampled
function displace(src, dst, rect, map, aa = 1) {
  const W = src.width, d = dst.data, tmp = [0, 0, 0, 0], q = [0, 0];
  const n = aa * aa;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < aa; sy++) for (let sx = 0; sx < aa; sx++) {
        const px = x + (sx + 0.5) / aa, py = y + (sy + 0.5) / aa;
        if (!map(px, py, q)) continue;
        sample(src, q[0], q[1], tmp);
        r += tmp[0] * tmp[3]; g += tmp[1] * tmp[3]; b += tmp[2] * tmp[3]; a += tmp[3];
      }
      const i = (y * W + x) * 4;
      if (a > 0) { d[i] = r / a; d[i + 1] = g / a; d[i + 2] = b / a; d[i + 3] = a / n; } else d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    }
  }
}

// Separable gaussian blur on premultiplied data over an area (rect expanded by radius).
function gaussian(src, dst, rect, radius) {
  const W = src.width, H = src.height;
  if (radius <= 0) { copyRect(src, dst, rect); return; }
  const r = Math.ceil(radius);
  const sigma = Math.max(0.5, radius / 2.5);
  const kernel = new Float32Array(2 * r + 1);
  let ks = 0;
  for (let i = -r; i <= r; i++) { kernel[i + r] = Math.exp((-i * i) / (2 * sigma * sigma)); ks += kernel[i + r]; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ks;
  const x0 = Math.max(0, rect.x - r), x1 = Math.min(W, rect.x + rect.w + r);
  const y0 = rect.y, y1 = rect.y + rect.h;
  const ay0 = Math.max(0, y0 - r), ay1 = Math.min(H, y1 + r);
  const tw = x1 - x0, th = ay1 - ay0;
  const tmp = new Float32Array(tw * th * 4);
  const s = src.data;
  // horizontal pass (premultiplied)
  for (let y = ay0; y < ay1; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let k = -r; k <= r; k++) {
        const xx = clamp(x + k, 0, W - 1), i = (y * W + xx) * 4, w = kernel[k + r] * s[i + 3];
        R += s[i] * w; G += s[i + 1] * w; B += s[i + 2] * w; A += w;
      }
      const o = ((y - ay0) * tw + (x - x0)) * 4;
      tmp[o] = R; tmp[o + 1] = G; tmp[o + 2] = B; tmp[o + 3] = A;
    }
  }
  const d = dst.data;
  for (let y = y0; y < y1; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let k = -r; k <= r; k++) {
        const yy = clamp(y + k, ay0, ay1 - 1), o = ((yy - ay0) * tw + (x - x0)) * 4, w = kernel[k + r];
        R += tmp[o] * w; G += tmp[o + 1] * w; B += tmp[o + 2] * w; A += tmp[o + 3] * w;
      }
      const i = (y * W + x) * 4;
      if (A > 0.001) { d[i] = R / A; d[i + 1] = G / A; d[i + 2] = B / A; d[i + 3] = A; } else d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    }
  }
}

function copyRect(src, dst, rect) {
  const W = src.width;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const i = (y * W + rect.x) * 4;
    dst.data.set(src.data.subarray(i, i + rect.w * 4), i);
  }
}

function cloneImg(src) { return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) }; }

// 3x3 convolution helper on color channels (alpha preserved)
function convolve(src, dst, rect, k, bias = 0, gray = false) {
  const W = src.width, H = src.height, s = src.data, d = dst.data;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = clamp(x + i, 0, W - 1), yy = clamp(y + j, 0, H - 1), p = (yy * W + xx) * 4, w = k[(j + 1) * 3 + (i + 1)];
      r += s[p] * w; g += s[p + 1] * w; b += s[p + 2] * w;
    }
    const o = (y * W + x) * 4;
    if (gray) { const v = c255((r + g + b) / 3 + bias); d[o] = d[o + 1] = d[o + 2] = v; } else { d[o] = c255(r + bias); d[o + 1] = c255(g + bias); d[o + 2] = c255(b + bias); }
    d[o + 3] = s[o + 3];
  }
}

function angleKernel(angleDeg) {
  // Directional emboss kernel weights following the light angle
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a), dy = -Math.sin(a);
  const k = new Float32Array(9);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    if (!i && !j) continue;
    const dot = (i * dx + j * dy) / Math.hypot(i, j);
    k[(j + 1) * 3 + (i + 1)] = -dot;
  }
  return k;
}

const toGray = (r, g, b) => (r * 0.299 + g * 0.587 + b * 0.114);

function hueSat(r, g, b, dh, ds, dl) {
  // HSL-based adjustment like paint.net's Hue/Saturation
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h + dh / 360 + 1) % 1;
  s = clamp(s * ds, 0, 1);
  if (dl > 0) l = l + (1 - l) * dl; else l = l + l * dl;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return s === 0 ? [l * 255, l * 255, l * 255] : [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// Perlin-like value noise for clouds
function makeNoise(seed) {
  const r = rng(seed), perm = new Uint8Array(512), grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; grad[i] = r() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const g2 = (h, x, y) => { const a = (h / 256) * Math.PI * 2; return Math.cos(a) * x + Math.sin(a) * y; };
  return (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1], ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
    const x1 = g2(aa, xf, yf) + (g2(ba, xf - 1, yf) - g2(aa, xf, yf)) * u;
    const x2 = g2(ab, xf, yf - 1) + (g2(bb, xf - 1, yf - 1) - g2(ab, xf, yf - 1)) * u;
    return x1 + (x2 - x1) * v; // ~ -0.7..0.7
  };
}

function histogramLevels(src, rect) {
  const s = src.data, W = src.width;
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    let i = (y * W + rect.x) * 4;
    for (let x = 0; x < rect.w; x++, i += 4) if (s[i + 3]) { hr[s[i]]++; hg[s[i + 1]]++; hb[s[i + 2]]++; }
  }
  return { hr, hg, hb };
}

function levelsLut(inLo, inHi, gamma, outLo, outHi) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let t = clamp((v - inLo) / Math.max(1, inHi - inLo), 0, 1);
    t = Math.pow(t, 1 / gamma);
    lut[v] = outLo + t * (outHi - outLo);
  }
  return lut;
}

// Monotone cubic interpolation through control points (0..255)
export function curveLut(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const lut = new Uint8ClampedArray(256);
  const n = pts.length;
  if (n === 1) { lut.fill(pts[0][1]); return lut; }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const dx = [], m = [], dy = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 1e-6; dy[i] = (ys[i + 1] - ys[i]) / dx[i]; }
  m[0] = dy[0]; m[n - 1] = dy[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (dy[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / dy[i], b = m[i + 1] / dy[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dy[i]; m[i + 1] = t * b * dy[i]; }
  }
  for (let v = 0; v < 256; v++) {
    if (v <= xs[0]) { lut[v] = ys[0]; continue; }
    if (v >= xs[n - 1]) { lut[v] = ys[n - 1]; continue; }
    let i = 0;
    while (v > xs[i + 1]) i++;
    const h = dx[i], t = (v - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    lut[v] = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  }
  return lut;
}

function fractalColor(t, angle) {
  // smooth rainbow palette
  const a = t * 6.2832 + angle;
  return [127.5 + 127.5 * Math.sin(a), 127.5 + 127.5 * Math.sin(a + 2.094), 127.5 + 127.5 * Math.sin(a + 4.188)];
}

const P = {
  int: (key, label, min, max, def, extra) => ({ type: 'int', key, label, min, max, def, ...extra }),
  float: (key, label, min, max, def, decimals = 2, extra) => ({ type: 'float', key, label, min, max, def, decimals, step: Math.pow(10, -decimals), ...extra }),
  angle: (key, label, def) => ({ type: 'angle', key, label, def }),
  bool: (key, label, def) => ({ type: 'bool', key, label, def }),
  choice: (key, label, options, def) => ({ type: 'choice', key, label, options, def }),
  pan: (key, label) => ({ type: 'pan', key, label, def: { x: 0, y: 0 } }),
  seed: (key = 'seed') => ({ type: 'seed', key, label: 'Random Noise', def: 1 }),
};

export const EFFECTS = {};
const def = (id, o) => { EFFECTS[id] = { id, ...o }; };

// =================== Adjustments ===================
def('autolevel', {
  menu: 'adjustments', name: 'Auto-Level', icon: 'a_autolevel', shortcut: 'Ctrl+Shift+L',
  render(src, dst, rect, p, env) {
    const { hr, hg, hb } = histogramLevels(src, env.sel);
    let total = 0; for (let i = 0; i < 256; i++) total += hr[i];
    const bounds = (h) => {
      const cut = total * 0.005; let lo = 0, hi = 255, acc = 0;
      for (; lo < 255; lo++) { acc += h[lo]; if (acc > cut) break; }
      acc = 0; for (; hi > 0; hi--) { acc += h[hi]; if (acc > cut) break; }
      return [lo, Math.max(lo + 1, hi)];
    };
    const [rl, rh] = bounds(hr), [gl, gh] = bounds(hg), [bl, bh] = bounds(hb);
    const lo = Math.min(rl, gl, bl), hi = Math.max(rh, gh, bh);
    const lut = levelsLut(lo, hi, 1, 0, 255);
    lutApply(src, dst, rect, lut, lut, lut);
  },
});
def('blackwhite', {
  menu: 'adjustments', name: 'Black and White', icon: 'a_bw', shortcut: 'Ctrl+Shift+G',
  render(src, dst, rect) { perPixel(src, dst, rect, (r, g, b, a) => { const v = toGray(r, g, b); return [v, v, v, a]; }); },
});
def('brightnesscontrast', {
  menu: 'adjustments', name: 'Brightness / Contrast', icon: 'a_brightness',
  params: [P.int('brightness', 'Brightness', -100, 100, 0), P.int('contrast', 'Contrast', -100, 100, 0)],
  render(src, dst, rect, p) {
    // paint.net-like: contrast stretches around mid-gray, brightness offsets
    const c = p.contrast, b = p.brightness;
    const mult = c < 0 ? (100 + c) / 100 : 100 / Math.max(1, 100 - c);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = (v - 127.5) * mult + 127.5 + b * 2.55 * (c < 0 ? 1 : 1);
    lutApply(src, dst, rect, lut, lut, lut);
  },
});
def('curves', {
  menu: 'adjustments', name: 'Curves', icon: 'a_curves', shortcut: 'Ctrl+Shift+M',
  params: [{ type: 'curves', key: 'curves', def: { mode: 'luminosity', l: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } }],
  render(src, dst, rect, p) {
    const c = p.curves;
    if (c.mode === 'luminosity') {
      const lut = curveLut(c.l);
      perPixel(src, dst, rect, (r, g, b, a) => {
        const l = toGray(r, g, b), nl = lut[Math.round(l)];
        if (l < 0.5) return [nl, nl, nl, a];
        const k = nl / l;
        return [c255(r * k), c255(g * k), c255(b * k), a];
      });
    } else lutApply(src, dst, rect, curveLut(c.r), curveLut(c.g), curveLut(c.b));
  },
});
def('huesaturation', {
  menu: 'adjustments', name: 'Hue / Saturation', icon: 'a_huesat', shortcut: 'Ctrl+Shift+U',
  params: [P.int('hue', 'Hue', -180, 180, 0), P.int('saturation', 'Saturation', 0, 200, 100), P.int('lightness', 'Lightness', -100, 100, 0)],
  render(src, dst, rect, p) {
    const ds = p.saturation / 100, dl = p.lightness / 100;
    perPixel(src, dst, rect, (r, g, b, a) => { const o = hueSat(r, g, b, p.hue, ds, dl); return [o[0], o[1], o[2], a]; });
  },
});
def('invert', {
  menu: 'adjustments', name: 'Invert Colors', icon: 'a_invert', shortcut: 'Ctrl+Shift+I',
  render(src, dst, rect) { perPixel(src, dst, rect, (r, g, b, a) => [255 - r, 255 - g, 255 - b, a]); },
});
def('levels', {
  menu: 'adjustments', name: 'Levels', icon: 'a_levels', shortcut: 'Ctrl+L',
  params: [{ type: 'levels', key: 'levels', def: { inLo: 0, inHi: 255, gamma: 1, outLo: 0, outHi: 255, r: true, g: true, b: true } }],
  render(src, dst, rect, p) {
    const L = p.levels;
    const lut = levelsLut(L.inLo, L.inHi, L.gamma, L.outLo, L.outHi);
    const id = new Uint8ClampedArray(256).map((_, i) => i);
    lutApply(src, dst, rect, L.r ? lut : id, L.g ? lut : id, L.b ? lut : id);
  },
});
def('posterize', {
  menu: 'adjustments', name: 'Posterize', icon: 'a_posterize', shortcut: 'Ctrl+Shift+P',
  params: [P.int('red', 'Red', 2, 64, 16), P.int('green', 'Green', 2, 64, 16), P.int('blue', 'Blue', 2, 64, 16)],
  render(src, dst, rect, p) {
    const mk = (n) => new Uint8ClampedArray(256).map((_, v) => Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1))));
    lutApply(src, dst, rect, mk(p.red), mk(p.green), mk(p.blue));
  },
});
def('sepia', {
  menu: 'adjustments', name: 'Sepia', icon: 'a_sepia', shortcut: 'Ctrl+Shift+E',
  render(src, dst, rect) {
    perPixel(src, dst, rect, (r, g, b, a) => {
      const v = toGray(r, g, b);
      return [c255(v * 1.0 + 40), c255(v * 0.89 + 20), c255(v * 0.7), a];
    });
  },
});

// =================== Effects: Artistic ===================
def('inksketch', {
  menu: 'Artistic', name: 'Ink Sketch', icon: 'e_artistic',
  params: [P.int('ink', 'Ink Outline', 0, 99, 50), P.int('coloring', 'Coloring', 0, 100, 50)],
  render(src, dst, rect, p) {
    const W = src.width, H = src.height, s = src.data, d = dst.data;
    const blurred = cloneImg(src);
    gaussian(src, blurred, { x: 0, y: Math.max(0, rect.y - 2), w: W, h: Math.min(H, rect.y + rect.h + 2) - Math.max(0, rect.y - 2) }, 1.5);
    const b = blurred.data;
    const ink = p.ink / 100, col = p.coloring / 100;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      let gx = 0, gy = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const q = (clamp(y + j, 0, H - 1) * W + clamp(x + i, 0, W - 1)) * 4;
        const v = toGray(b[q], b[q + 1], b[q + 2]);
        gx += v * i * (j ? 1 : 2); gy += v * j * (i ? 1 : 2);
      }
      const edge = clamp(Math.hypot(gx, gy) * (0.5 + ink * 3) / 4, 0, 255);
      const o = (y * W + x) * 4;
      const gray = toGray(s[o], s[o + 1], s[o + 2]);
      for (let k = 0; k < 3; k++) {
        const base = gray + (s[o + k] - gray) * col;
        const light = 255 - (255 - base) * (0.25 + 0.75 * col);
        d[o + k] = c255(light - edge);
      }
      d[o + 3] = s[o + 3];
    }
  },
});
def('oilpainting', {
  menu: 'Artistic', name: 'Oil Painting', icon: 'e_artistic',
  params: [P.int('size', 'Brush size', 1, 8, 3), P.int('coarseness', 'Coarseness', 3, 255, 50)],
  render(src, dst, rect, p) {
    const W = src.width, H = src.height, s = src.data, d = dst.data, r = p.size, levels = p.coarseness;
    const cnt = new Uint32Array(256), sr = new Float64Array(256), sg = new Float64Array(256), sb = new Float64Array(256);
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
      let best = 0, bi = 0;
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const q = (clamp(y + j, 0, H - 1) * W + clamp(x + i, 0, W - 1)) * 4;
        const lvl = Math.floor((toGray(s[q], s[q + 1], s[q + 2]) * (levels - 1)) / 255);
        cnt[lvl]++; sr[lvl] += s[q]; sg[lvl] += s[q + 1]; sb[lvl] += s[q + 2];
        if (cnt[lvl] > best) { best = cnt[lvl]; bi = lvl; }
      }
      const o = (y * W + x) * 4;
      d[o] = sr[bi] / best; d[o + 1] = sg[bi] / best; d[o + 2] = sb[bi] / best; d[o + 3] = s[o + 3];
    }
  },
});
def('pencilsketch', {
  menu: 'Artistic', name: 'Pencil Sketch', icon: 'e_artistic',
  params: [P.int('tip', 'Pencil tip size', 1, 20, 2), P.int('range', 'Color range', -20, 20, 0)],
  render(src, dst, rect, p) {
    const W = src.width, s = src.data, d = dst.data;
    const gray = cloneImg(src);
    const g = gray.data;
    for (let i = 0; i < g.length; i += 4) { const v = 255 - toGray(s[i], s[i + 1], s[i + 2]); g[i] = g[i + 1] = g[i + 2] = v; g[i + 3] = 255; }
    const bl = cloneImg(gray);
    gaussian(gray, bl, { x: 0, y: 0, w: W, h: src.height }, p.tip * 3 + 2);
    const shade = 0.35 + p.range / 50;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const o = (y * W + x) * 4;
      const base = 255 - g[o], blend = bl.data[o];
      // color dodge of the gray image with its blurred negative → pencil lines
      let v = blend >= 255 ? 255 : Math.min(255, (base * 255) / (255 - blend));
      v = Math.pow(v / 255, 2.2) * 255;
      // add some soft graphite shading from the tonal values
      v = v * (1 - shade) + v * (base / 255) * shade;
      d[o] = d[o + 1] = d[o + 2] = c255(v); d[o + 3] = s[o + 3];
    }
  },
});

// =================== Effects: Blurs ===================
def('fragment', {
  menu: 'Blurs', name: 'Fragment', icon: 'e_blur',
  params: [P.int('fragments', 'Fragments', 2, 50, 4), P.int('distance', 'Distance', 0, 100, 8), P.angle('rotation', 'Rotation', 0)],
  render(src, dst, rect, p) {
    const W = src.width, d = dst.data, tmp = [0, 0, 0, 0];
    const offs = [];
    for (let i = 0; i < p.fragments; i++) {
      const a = (p.rotation * Math.PI) / 180 + (i * Math.PI * 2) / p.fragments;
      offs.push([Math.cos(a) * p.distance, Math.sin(a) * p.distance]);
    }
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [ox, oy] of offs) {
        nearest(src, x + ox + 0.5, y + oy + 0.5, tmp);
        r += tmp[0] * tmp[3]; g += tmp[1] * tmp[3]; b += tmp[2] * tmp[3]; a += tmp[3];
      }
      const o = (y * W + x) * 4;
      if (a) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; d[o + 3] = a / offs.length; } else d[o + 3] = 0;
    }
  },
});
def('gaussianblur', {
  menu: 'Blurs', name: 'Gaussian Blur', icon: 'e_blur',
  params: [P.int('radius', 'Radius', 0, 200, 2)],
  render(src, dst, rect, p) { gaussian(src, dst, rect, p.radius); },
});
def('motionblur', {
  menu: 'Blurs', name: 'Motion Blur', icon: 'e_blur',
  params: [P.angle('angle', 'Angle', 25), P.bool('centered', 'Centered', true), P.int('distance', 'Distance', 1, 200, 10)],
  render(src, dst, rect, p) {
    const W = src.width, d = dst.data, tmp = [0, 0, 0, 0];
    const a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = -Math.sin(a);
    const n = Math.max(2, Math.ceil(p.distance));
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let i = 0; i <= n; i++) {
        const t = (p.centered ? i / n - 0.5 : -i / n) * p.distance;
        sample(src, x + 0.5 + dx * t, y + 0.5 + dy * t, tmp);
        r += tmp[0] * tmp[3]; g += tmp[1] * tmp[3]; b += tmp[2] * tmp[3]; al += tmp[3];
      }
      const o = (y * W + x) * 4;
      if (al) { d[o] = r / al; d[o + 1] = g / al; d[o + 2] = b / al; d[o + 3] = al / (n + 1); } else d[o + 3] = 0;
    }
  },
});
def('radialblur', {
  menu: 'Blurs', name: 'Radial Blur', icon: 'e_blur',
  params: [P.angle('angle', 'Angle', 2), P.pan('offset', 'Offset'), P.int('quality', 'Quality', 1, 5, 2)],
  render(src, dst, rect, p, env) {
    const W = src.width, d = dst.data, tmp = [0, 0, 0, 0], S = env.sel;
    const cx = S.x + S.w / 2 + (p.offset.x * S.w) / 2, cy = S.y + S.h / 2 + (p.offset.y * S.h) / 2;
    const ang = (p.angle * Math.PI) / 180;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rr = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx);
      const n = Math.max(1, Math.min(64, Math.ceil(rr * ang * p.quality * 0.5)));
      let r = 0, g = 0, b = 0, al = 0;
      for (let i = 0; i <= n; i++) {
        const a = a0 + ang * (i / n - 0.5);
        sample(src, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, tmp);
        r += tmp[0] * tmp[3]; g += tmp[1] * tmp[3]; b += tmp[2] * tmp[3]; al += tmp[3];
      }
      const o = (y * W + x) * 4;
      if (al) { d[o] = r / al; d[o + 1] = g / al; d[o + 2] = b / al; d[o + 3] = al / (n + 1); } else d[o + 3] = 0;
    }
  },
});
def('surfaceblur', {
  menu: 'Blurs', name: 'Surface Blur', icon: 'e_blur',
  params: [P.int('radius', 'Radius', 1, 50, 6), P.int('threshold', 'Threshold', 1, 100, 15)],
  render(src, dst, rect, p) {
    const W = src.width, H = src.height, s = src.data, d = dst.data, r = p.radius, t = p.threshold * 2.5;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const o = (y * W + x) * 4;
      let R = 0, G = 0, B = 0, A = 0, ws = 0;
      const step = r > 12 ? 2 : 1;
      for (let j = -r; j <= r; j += step) for (let i = -r; i <= r; i += step) {
        const q = (clamp(y + j, 0, H - 1) * W + clamp(x + i, 0, W - 1)) * 4;
        const diff = (Math.abs(s[q] - s[o]) + Math.abs(s[q + 1] - s[o + 1]) + Math.abs(s[q + 2] - s[o + 2])) / 3;
        const w = Math.max(0, 1 - diff / t);
        R += s[q] * w; G += s[q + 1] * w; B += s[q + 2] * w; A += s[q + 3] * w; ws += w;
      }
      d[o] = R / ws; d[o + 1] = G / ws; d[o + 2] = B / ws; d[o + 3] = A / ws;
    }
  },
});
def('unfocus', {
  menu: 'Blurs', name: 'Unfocus', icon: 'e_blur',
  params: [P.int('radius', 'Radius', 1, 200, 4)],
  render(src, dst, rect, p) {
    const W = src.width, H = src.height, s = src.data, d = dst.data, r = p.radius;
    // Disk average using per-row prefix sums of premultiplied values
    const y0 = Math.max(0, rect.y - r), y1 = Math.min(H, rect.y + rect.h + r);
    const pre = new Float64Array((y1 - y0) * (W + 1) * 4);
    for (let y = y0; y < y1; y++) {
      const base = (y - y0) * (W + 1) * 4;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, a = s[i + 3], o = base + (x + 1) * 4, pv = base + x * 4;
        pre[o] = pre[pv] + s[i] * a; pre[o + 1] = pre[pv + 1] + s[i + 1] * a; pre[o + 2] = pre[pv + 2] + s[i + 2] * a; pre[o + 3] = pre[pv + 3] + a;
      }
    }
    const span = [];
    for (let j = -r; j <= r; j++) span.push(Math.floor(Math.sqrt(r * r - j * j)));
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      let R = 0, G = 0, B = 0, A = 0, n = 0;
      for (let j = -r; j <= r; j++) {
        const yy = y + j;
        if (yy < y0 || yy >= y1) continue;
        const sp = span[j + r], xa = Math.max(0, x - sp), xb = Math.min(W - 1, x + sp);
        const base = (yy - y0) * (W + 1) * 4, i1 = base + (xb + 1) * 4, i0 = base + xa * 4;
        R += pre[i1] - pre[i0]; G += pre[i1 + 1] - pre[i0 + 1]; B += pre[i1 + 2] - pre[i0 + 2]; A += pre[i1 + 3] - pre[i0 + 3];
        n += xb - xa + 1;
      }
      const o = (y * W + x) * 4;
      if (A > 0) { d[o] = R / A; d[o + 1] = G / A; d[o + 2] = B / A; d[o + 3] = A / n; } else d[o + 3] = 0;
    }
  },
});
def('zoomblur', {
  menu: 'Blurs', name: 'Zoom Blur', icon: 'e_blur',
  params: [P.int('amount', 'Zoom amount', 0, 100, 10), P.pan('offset', 'Offset')],
  render(src, dst, rect, p, env) {
    const W = src.width, d = dst.data, tmp = [0, 0, 0, 0], S = env.sel;
    const cx = S.x + S.w / 2 + (p.offset.x * S.w) / 2, cy = S.y + S.h / 2 + (p.offset.y * S.h) / 2;
    const amt = p.amount / 100 * 0.5;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const n = Math.max(1, Math.min(64, Math.ceil(Math.hypot(dx, dy) * amt)));
      let r = 0, g = 0, b = 0, al = 0;
      for (let i = 0; i <= n; i++) {
        const f = 1 - (amt * i) / n;
        sample(src, cx + dx * f, cy + dy * f, tmp);
        r += tmp[0] * tmp[3]; g += tmp[1] * tmp[3]; b += tmp[2] * tmp[3]; al += tmp[3];
      }
      const o = (y * W + x) * 4;
      if (al) { d[o] = r / al; d[o + 1] = g / al; d[o + 2] = b / al; d[o + 3] = al / (n + 1); } else d[o + 3] = 0;
    }
  },
});

// =================== Effects: Distort ===================
def('bulge', {
  menu: 'Distort', name: 'Bulge', icon: 'e_distort',
  params: [P.int('amount', 'Bulge', -200, 100, 45), P.pan('offset', 'Offset')],
  render(src, dst, rect, p, env) {
    const S = env.sel, cx = S.x + S.w / 2 + (p.offset.x * S.w) / 2, cy = S.y + S.h / 2 + (p.offset.y * S.h) / 2;
    const R = Math.min(S.w, S.h) / 2, amt = p.amount / 100;
    displace(src, dst, rect, (x, y, q) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d >= R || d === 0) { q[0] = x; q[1] = y; return true; }
      const t = d / R, f = 1 - amt * (1 - t) * (1 - t) * 0.9;
      q[0] = cx + dx * f; q[1] = cy + dy * f; return true;
    }, 2);
  },
});
def('dents', {
  menu: 'Distort', name: 'Dents', icon: 'e_distort',
  params: [P.int('scale', 'Scale', 1, 200, 25), P.float('refraction', 'Refraction', 0, 200, 50, 0), P.int('roughness', 'Roughness', 0, 100, 10), P.int('tension', 'Tension', 0, 100, 10), P.int('quality', 'Quality', 1, 5, 2), P.seed()],
  render(src, dst, rect, p) {
    const n1 = makeNoise(p.seed), n2 = makeNoise(p.seed + 7919);
    const sc = p.scale, amt = p.refraction * 0.4, rough = p.roughness / 100, oct = 1 + Math.round(rough * 4);
    const fbm = (n, x, y) => { let v = 0, a = 1, f = 1; for (let i = 0; i < oct; i++) { v += n(x * f, y * f) * a; a *= 0.5; f *= 2; } return v; };
    displace(src, dst, rect, (x, y, q) => {
      const u = x / sc, v = y / sc;
      q[0] = x + fbm(n1, u, v) * amt * (1 + p.tension / 50);
      q[1] = y + fbm(n2, u, v) * amt * (1 + p.tension / 50);
      return true;
    }, p.quality > 2 ? 2 : 1);
  },
});
def('frostedglass', {
  menu: 'Distort', name: 'Frosted Glass', icon: 'e_distort',
  params: [P.int('amount', 'Scatter radius', 1, 200, 3), P.int('quality', 'Quality', 1, 5, 2), P.seed()],
  render(src, dst, rect, p) {
    const W = src.width, H = src.height, s = src.data, d = dst.data, r = rng(p.seed);
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let k = 0; k < p.quality; k++) {
        const xx = clamp(Math.round(x + (r() * 2 - 1) * p.amount), 0, W - 1), yy = clamp(Math.round(y + (r() * 2 - 1) * p.amount), 0, H - 1);
        const q = (yy * W + xx) * 4;
        R += s[q] * s[q + 3]; G += s[q + 1] * s[q + 3]; B += s[q + 2] * s[q + 3]; A += s[q + 3];
      }
      const o = (y * W + x) * 4;
      if (A) { d[o] = R / A; d[o + 1] = G / A; d[o + 2] = B / A; d[o + 3] = A / p.quality; } else d[o + 3] = 0;
    }
  },
});
def('pixelate', {
  menu: 'Distort', name: 'Pixelate', icon: 'e_distort',
  params: [P.int('size', 'Cell size', 1, 100, 2)],
  render(src, dst, rect, p, env) {
    const W = src.width, s = src.data, d = dst.data, c = p.size, S = env.sel;
    for (let by = S.y; by < S.y + S.h; by += c) for (let bx = S.x; bx < S.x + S.w; bx += c) {
      const x1 = Math.min(bx + c, S.x + S.w), y1 = Math.min(by + c, S.y + S.h);
      let R = 0, G = 0, B = 0, A = 0, n = 0;
      for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) {
        const q = (y * W + x) * 4; R += s[q] * s[q + 3]; G += s[q + 1] * s[q + 3]; B += s[q + 2] * s[q + 3]; A += s[q + 3]; n++;
      }
      const r0 = A ? R / A : 0, g0 = A ? G / A : 0, b0 = A ? B / A : 0, a0 = A / n;
      for (let y = Math.max(by, rect.y); y < Math.min(y1, rect.y + rect.h); y++) for (let x = Math.max(bx, rect.x); x < Math.min(x1, rect.x + rect.w); x++) {
        const o = (y * W + x) * 4; d[o] = r0; d[o + 1] = g0; d[o + 2] = b0; d[o + 3] = a0;
      }
    }
  },
});
def('polarinversion', {
  menu: 'Distort', name: 'Polar Inversion', icon: 'e_distort',
  params: [P.float('amount', 'Amount', -4, 4, 2, 2), P.pan('offset', 'Offset'), P.choice('edge', 'Edge behavior', [['clamp', 'Clamp'], ['reflect', 'Reflect'], ['wrap', 'Wrap']], 'wrap')],
  render(src, dst, rect, p, env) {
    const S = env.sel, cx = S.x + S.w / 2 + (p.offset.x * S.w) / 2, cy = S.y + S.h / 2 + (p.offset.y * S.h) / 2;
    const R2 = (Math.min(S.w, S.h) / 2) ** 2 * p.amount * 0.5;
    const W = src.width, H = src.height;
    const edge = (v, max) => {
      if (p.edge === 'wrap') return ((v % max) + max) % max;
      if (p.edge === 'reflect') { v = Math.abs(v) % (2 * max); return v > max ? 2 * max - v : v; }
      return clamp(v, 0, max);
    };
    displace(src, dst, rect, (x, y, q) => {
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy || 1e-6;
      q[0] = edge(cx + (dx * R2) / d2, W); q[1] = edge(cy + (dy * R2) / d2, H);
      return true;
    }, 2);
  },
});
def('tilereflection', {
  menu: 'Distort', name: 'Tile Reflection', icon: 'e_distort',
  params: [P.angle('angle', 'Angle', 30), P.int('size', 'Tile size', 2, 200, 40), P.int('curvature', 'Curvature', -100, 100, 8), P.int('quality', 'Quality', 1, 5, 2)],
  render(src, dst, rect, p) {
    const a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), sz = p.size, curv = p.curvature / 100;
    displace(src, dst, rect, (x, y, q) => {
      let u = x * ca + y * sa, v = -x * sa + y * ca;
      const fu = ((u % sz) + sz) % sz / sz - 0.5, fv = ((v % sz) + sz) % sz / sz - 0.5;
      u += Math.sin(fu * Math.PI) * curv * sz * 0.5; v += Math.sin(fv * Math.PI) * curv * sz * 0.5;
      q[0] = u * ca - v * sa; q[1] = u * sa + v * ca;
      return true;
    }, Math.min(3, p.quality));
  },
});
def('twist', {
  menu: 'Distort', name: 'Twist', icon: 'e_distort',
  params: [P.int('amount', 'Amount', -100, 100, 30), P.int('aa', 'Antialias', 1, 5, 2), P.pan('offset', 'Offset')],
  render(src, dst, rect, p, env) {
    const S = env.sel, cx = S.x + S.w / 2 + (p.offset.x * S.w) / 2, cy = S.y + S.h / 2 + (p.offset.y * S.h) / 2;
    const R = Math.min(S.w, S.h) / 2, amt = (p.amount / 10) * Math.PI / 2;
    displace(src, dst, rect, (x, y, q) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d >= R) { q[0] = x; q[1] = y; return true; }
      const t = 1 - d / R, a = Math.atan2(dy, dx) + amt * t * t;
      q[0] = cx + Math.cos(a) * d; q[1] = cy + Math.sin(a) * d;
      return true;
    }, Math.min(3, p.aa));
  },
});

// =================== Effects: Noise ===================
def('addnoise', {
  menu: 'Noise', name: 'Add Noise', icon: 'e_noise',
  params: [P.int('intensity', 'Intensity', 0, 100, 64), P.int('saturation', 'Color Saturation', 0, 400, 100), P.float('coverage', 'Coverage', 0, 100, 100, 2), P.seed()],
  render(src, dst, rect, p) {
    const W = src.width, s = src.data, d = dst.data;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      const r = rng(p.seed * 7919 + y);
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const o = (y * W + x) * 4;
        const n0 = r(), n1 = r(), n2 = r(), n3 = r(), cov = r();
        if (cov * 100 > p.coverage) { d[o] = s[o]; d[o + 1] = s[o + 1]; d[o + 2] = s[o + 2]; d[o + 3] = s[o + 3]; continue; }
        const g = (n0 + n1 + n2 - 1.5) * p.intensity * 1.6;
        const sat = p.saturation / 100;
        const cr = (r() - 0.5) * p.intensity * sat, cg = (n3 - 0.5) * p.intensity * sat, cb = (r() - 0.5) * p.intensity * sat;
        d[o] = c255(s[o] + g + cr); d[o + 1] = c255(s[o + 1] + g + cg); d[o + 2] = c255(s[o + 2] + g + cb); d[o + 3] = s[o + 3];
      }
    }
  },
});
def('median', {
  menu: 'Noise', name: 'Median', icon: 'e_noise',
  params: [P.int('radius', 'Radius', 1, 50, 10), P.int('percentile', 'Percentile', 0, 100, 50)],
  render(src, dst, rect, p) {
    const W = src.width, H = src.height, s = src.data, d = dst.data, r = p.radius;
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), ha = new Uint32Array(256);
    const pick = (h, n) => { const target = Math.min(n - 1, Math.floor((n * p.percentile) / 100)); let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc > target) return v; } return 255; };
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      hr.fill(0); hg.fill(0); hb.fill(0); ha.fill(0);
      let n = 0;
      const add = (x, sign) => {
        for (let j = -r; j <= r; j++) {
          const q = (clamp(y + j, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4;
          hr[s[q]] += sign; hg[s[q + 1]] += sign; hb[s[q + 2]] += sign; ha[s[q + 3]] += sign; n += sign;
        }
      };
      for (let i = -r; i <= r; i++) add(rect.x + i, 1);
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const o = (y * W + x) * 4;
        d[o] = pick(hr, n); d[o + 1] = pick(hg, n); d[o + 2] = pick(hb, n); d[o + 3] = pick(ha, n);
        add(x - r, -1); add(x + r + 1, 1);
      }
    }
  },
});
def('reducenoise', {
  menu: 'Noise', name: 'Reduce Noise', icon: 'e_noise',
  params: [P.int('radius', 'Radius', 0, 200, 6), P.float('strength', 'Strength', 0, 1, 0.4, 2)],
  render(src, dst, rect, p) {
    const W = src.width, s = src.data, d = dst.data;
    const bl = cloneImg(src);
    EFFECTS.median.render(src, bl, rect, { radius: Math.max(1, Math.round(p.radius / 2)), percentile: 50 });
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) d[o + k] = s[o + k] + (bl.data[o + k] - s[o + k]) * p.strength;
      d[o + 3] = s[o + 3];
    }
  },
});

// =================== Effects: Object ===================
def('dropshadow', {
  menu: 'Object', name: 'Drop Shadow', icon: 'e_object',
  params: [P.int('offsetX', 'Offset X', -100, 100, 4), P.int('offsetY', 'Offset Y', -100, 100, 4), P.int('blur', 'Blur radius', 0, 100, 4), P.int('opacity', 'Shadow opacity', 0, 255, 128)],
  render(src, dst, rect, p, env) {
    const W = src.width, H = src.height, s = src.data, d = dst.data;
    const sh = { width: W, height: H, data: new Uint8ClampedArray(s.length) };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = x - p.offsetX, sy = y - p.offsetY, o = (y * W + x) * 4;
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) sh.data[o + 3] = s[(sy * W + sx) * 4 + 3];
    }
    const bl = cloneImg(sh);
    gaussian(sh, bl, rect, p.blur);
    const c = env.primary, op = p.opacity / 255;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const o = (y * W + x) * 4, sa = (bl.data[o + 3] / 255) * op, fa = s[o + 3] / 255;
      const ao = fa + sa * (1 - fa);
      if (ao <= 0) { d[o + 3] = 0; continue; }
      d[o] = (s[o] * fa + c.r * sa * (1 - fa)) / ao; d[o + 1] = (s[o + 1] * fa + c.g * sa * (1 - fa)) / ao; d[o + 2] = (s[o + 2] * fa + c.b * sa * (1 - fa)) / ao;
      d[o + 3] = ao * 255;
    }
  },
});

// =================== Effects: Photo ===================
def('glow', {
  menu: 'Photo', name: 'Glow', icon: 'e_photo',
  params: [P.int('radius', 'Radius', 1, 20, 6), P.int('brightness', 'Brightness', -100, 100, 10), P.int('contrast', 'Contrast', -100, 100, 10)],
  render(src, dst, rect, p) {
    const W = src.width, s = src.data, d = dst.data;
    const bl = cloneImg(src);
    gaussian(src, bl, rect, p.radius);
    const mult = p.contrast < 0 ? (100 + p.contrast) / 100 : 100 / Math.max(1, 100 - p.contrast);
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        const g = c255((bl.data[o + k] - 127.5) * mult + 127.5 + p.brightness * 2.55) / 255, b = s[o + k] / 255;
        d[o + k] = (1 - (1 - b) * (1 - g)) * 255;
      }
      d[o + 3] = s[o + 3];
    }
  },
});
def('redeye', {
  menu: 'Photo', name: 'Red Eye Removal', icon: 'e_photo',
  params: [P.int('tolerance', 'Tolerance', 0, 100, 70), P.int('saturation', 'Saturation percentage', 0, 100, 90)],
  render(src, dst, rect, p) {
    const tol = p.tolerance / 100, sat = p.saturation / 100;
    const hueRange = 6 + tol * 18;
    perPixel(src, dst, rect, (r, g, b, a) => {
      const mx = Math.max(g, b);
      if (r <= mx || r < 50) return [r, g, b, a];
      // hue distance from pure red, in degrees
      const hue = Math.abs(((g - b) / (r - Math.min(g, b))) * 60);
      const satv = (r - Math.min(g, b)) / r;
      if (hue > hueRange || satv < 0.4 - tol * 0.2) return [r, g, b, a];
      const f = (1 - hue / hueRange) * sat;
      return [r - (r - (g + b) / 2) * f, g, b, a];
    });
  },
});
def('sharpen', {
  menu: 'Photo', name: 'Sharpen', icon: 'e_photo',
  params: [P.int('amount', 'Amount', 1, 20, 2)],
  render(src, dst, rect, p) {
    const W = src.width, s = src.data, d = dst.data;
    const bl = cloneImg(src);
    gaussian(src, bl, rect, p.amount);
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) d[o + k] = c255(s[o + k] + (s[o + k] - bl.data[o + k]) * 0.8);
      d[o + 3] = s[o + 3];
    }
  },
});
def('softenportrait', {
  menu: 'Photo', name: 'Soften Portrait', icon: 'e_photo',
  params: [P.int('softness', 'Softness', 0, 10, 5), P.int('lighting', 'Lighting', -20, 20, 0), P.int('warmth', 'Warmth', 0, 20, 10)],
  render(src, dst, rect, p) {
    const W = src.width, s = src.data, d = dst.data;
    const bl = cloneImg(src);
    gaussian(src, bl, rect, p.softness * 1.5);
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const o = (y * W + x) * 4;
      let r = (s[o] + bl.data[o]) / 2 + p.lighting * 2, g = (s[o + 1] + bl.data[o + 1]) / 2 + p.lighting * 2, b = (s[o + 2] + bl.data[o + 2]) / 2 + p.lighting * 2;
      const w = p.warmth / 20;
      const gray = toGray(r, g, b);
      r = r + (c255(gray * 1.0 + 40) - r) * w * 0.3; g = g + (c255(gray * 0.89 + 20) - g) * w * 0.3; b = b + (c255(gray * 0.7) - b) * w * 0.3;
      d[o] = c255(r); d[o + 1] = c255(g); d[o + 2] = c255(b); d[o + 3] = s[o + 3];
    }
  },
});
def('vignette', {
  menu: 'Photo', name: 'Vignette', icon: 'e_photo',
  params: [P.pan('offset', 'Center'), P.float('radius', 'Radius', 0.1, 4, 1, 2), P.int('density', 'Density', 0, 100, 100)],
  render(src, dst, rect, p, env) {
    const S = env.sel, cx = S.x + S.w / 2 + (p.offset.x * S.w) / 2, cy = S.y + S.h / 2 + (p.offset.y * S.h) / 2;
    const R = (Math.hypot(S.w, S.h) / 2) * p.radius, dens = p.density / 100, W = src.width, s = src.data, d = dst.data;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const t = clamp(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R, 0, 1);
      const f = 1 - dens * (t * t * (3 - 2 * t));
      const o = (y * W + x) * 4;
      d[o] = s[o] * f; d[o + 1] = s[o + 1] * f; d[o + 2] = s[o + 2] * f; d[o + 3] = s[o + 3];
    }
  },
});

// =================== Effects: Render ===================
def('clouds', {
  menu: 'Render', name: 'Clouds', icon: 'e_render',
  params: [P.int('scale', 'Scale', 2, 1000, 250), P.float('power', 'Roughness', 0, 1, 0.5, 2), P.choice('blend', 'Blend mode', [['normal', 'Normal'], ['multiply', 'Multiply'], ['overlay', 'Overlay'], ['screen', 'Screen']], 'normal'), P.seed()],
  render(src, dst, rect, p, env) {
    const W = src.width, s = src.data, d = dst.data, noise = makeNoise(p.seed);
    const c0 = env.primary, c1 = env.secondary;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      let v = 0, amp = 1, f = 1 / p.scale, tot = 0;
      for (let o = 0; o < 8; o++) { v += noise(x * f, y * f) * amp; tot += amp; amp *= p.power; f *= 2; }
      const t = clamp(v / tot * 1.4 + 0.5, 0, 1);
      const r = c0.r + (c1.r - c0.r) * t, g = c0.g + (c1.g - c0.g) * t, b = c0.b + (c1.b - c0.b) * t, a = (c0.a + (c1.a - c0.a) * t) / 255;
      const o = (y * W + x) * 4;
      const bl = (bs, cs) => {
        const B = bs / 255, C = cs / 255;
        if (p.blend === 'multiply') return B * C * 255;
        if (p.blend === 'screen') return (1 - (1 - B) * (1 - C)) * 255;
        if (p.blend === 'overlay') return (B < 0.5 ? 2 * B * C : 1 - 2 * (1 - B) * (1 - C)) * 255;
        return cs;
      };
      const sa = s[o + 3] / 255;
      if (p.blend === 'normal') {
        const ao = a + sa * (1 - a);
        d[o] = ao ? (r * a + s[o] * sa * (1 - a)) / ao : 0; d[o + 1] = ao ? (g * a + s[o + 1] * sa * (1 - a)) / ao : 0; d[o + 2] = ao ? (b * a + s[o + 2] * sa * (1 - a)) / ao : 0; d[o + 3] = ao * 255;
      } else {
        d[o] = s[o] + (bl(s[o], r) - s[o]) * a; d[o + 1] = s[o + 1] + (bl(s[o + 1], g) - s[o + 1]) * a; d[o + 2] = s[o + 2] + (bl(s[o + 2], b) - s[o + 2]) * a; d[o + 3] = s[o + 3];
      }
    }
  },
});
def('julia', {
  menu: 'Render', name: 'Julia Fractal', icon: 'e_render',
  params: [P.float('factor', 'Factor', 1, 10, 4, 1), P.int('quality', 'Quality', 1, 5, 2), P.int('zoom', 'Zoom', 0, 50, 1), P.angle('angle', 'Angle', 0)],
  render(src, dst, rect, p, env) {
    const W = src.width, d = dst.data, S = env.sel, aa = p.quality;
    const scale = 2.5 / (Math.min(S.w, S.h) * (1 + p.zoom * 0.2));
    const ca = Math.cos((p.angle * Math.PI) / 180), sa = Math.sin((p.angle * Math.PI) / 180);
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let j = 0; j < aa; j++) for (let i = 0; i < aa; i++) {
        const u0 = (x + (i + 0.5) / aa - S.x - S.w / 2) * scale, v0 = (y + (j + 0.5) / aa - S.y - S.h / 2) * scale;
        let zx = u0 * ca - v0 * sa, zy = u0 * sa + v0 * ca, it = 0;
        const max = 64 * p.factor;
        while (it < max && zx * zx + zy * zy < 4) { const t = zx * zx - zy * zy - 0.73; zy = 2 * zx * zy + 0.19; zx = t; it++; }
        if (it < max) { const c = fractalColor(it / 40, 0); R += c[0]; G += c[1]; B += c[2]; A += 255; }
      }
      const o = (y * W + x) * 4, n = aa * aa;
      d[o] = A ? (R / A) * 255 : 0; d[o + 1] = A ? (G / A) * 255 : 0; d[o + 2] = A ? (B / A) * 255 : 0; d[o + 3] = A / n;
    }
  },
});
def('mandelbrot', {
  menu: 'Render', name: 'Mandelbrot Fractal', icon: 'e_render',
  params: [P.int('factor', 'Factor', 1, 10, 1), P.int('quality', 'Quality', 1, 5, 2), P.int('zoom', 'Zoom', 0, 50, 10), P.angle('angle', 'Angle', 0), P.bool('invert', 'Invert colors', false)],
  render(src, dst, rect, p, env) {
    const W = src.width, d = dst.data, S = env.sel, aa = p.quality;
    const scale = 3 / (Math.min(S.w, S.h) * (0.5 + p.zoom * 0.1));
    const ca = Math.cos((p.angle * Math.PI) / 180), sa = Math.sin((p.angle * Math.PI) / 180);
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let j = 0; j < aa; j++) for (let i = 0; i < aa; i++) {
        const u0 = (x + (i + 0.5) / aa - S.x - S.w / 2) * scale, v0 = (y + (j + 0.5) / aa - S.y - S.h / 2) * scale;
        const cx = u0 * ca - v0 * sa - 0.6, cy = u0 * sa + v0 * ca;
        let zx = 0, zy = 0, it = 0;
        const max = 100 * p.factor;
        while (it < max && zx * zx + zy * zy < 16) { const t = zx * zx - zy * zy + cx; zy = 2 * zx * zy + cy; zx = t; it++; }
        if (it < max) {
          const sm = it + 1 - Math.log(Math.log(Math.sqrt(zx * zx + zy * zy))) / Math.LN2;
          let c = fractalColor(sm / 32, 2);
          if (p.invert) c = [255 - c[0], 255 - c[1], 255 - c[2]];
          R += c[0] * 255; G += c[1] * 255; B += c[2] * 255; A += 255;
        }
      }
      const o = (y * W + x) * 4, n = aa * aa;
      d[o] = A ? R / A : 0; d[o + 1] = A ? G / A : 0; d[o + 2] = A ? B / A : 0; d[o + 3] = A / n;
    }
  },
});

// =================== Effects: Stylize ===================
def('edgedetect', {
  menu: 'Stylize', name: 'Edge Detect', icon: 'e_stylize',
  params: [P.angle('angle', 'Angle', 45)],
  render(src, dst, rect, p) { convolve(src, dst, rect, angleKernel(p.angle), 128); },
});
def('emboss', {
  menu: 'Stylize', name: 'Emboss', icon: 'e_stylize',
  params: [P.angle('angle', 'Angle', 0)],
  render(src, dst, rect, p) { convolve(src, dst, rect, angleKernel(p.angle), 128, true); },
});
def('outline', {
  menu: 'Stylize', name: 'Outline', icon: 'e_stylize',
  params: [P.int('thickness', 'Thickness', 1, 200, 3), P.int('intensity', 'Intensity', 0, 100, 50)],
  render(src, dst, rect, p) {
    const W = src.width, H = src.height, s = src.data, d = dst.data, r = p.thickness;
    const inten = p.intensity / 100;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const o = (y * W + x) * 4;
      let mn = [255, 255, 255];
      const step = r > 8 ? Math.ceil(r / 8) : 1;
      for (let j = -r; j <= r; j += step) for (let i = -r; i <= r; i += step) {
        if (i * i + j * j > r * r) continue;
        const q = (clamp(y + j, 0, H - 1) * W + clamp(x + i, 0, W - 1)) * 4;
        if (s[q] < mn[0]) mn[0] = s[q]; if (s[q + 1] < mn[1]) mn[1] = s[q + 1]; if (s[q + 2] < mn[2]) mn[2] = s[q + 2];
      }
      for (let k = 0; k < 3; k++) {
        const diff = s[o + k] - mn[k];
        d[o + k] = c255(255 - diff * (1 + inten * 4) * 0.5 - (255 - s[o + k]) * (1 - inten) * 0.5);
      }
      d[o + 3] = s[o + 3];
    }
  },
});
def('relief', {
  menu: 'Stylize', name: 'Relief', icon: 'e_stylize',
  params: [P.angle('angle', 'Angle', 45)],
  render(src, dst, rect, p) {
    const k = angleKernel(p.angle).map((v) => v * 0.5);
    k[4] = 1;
    convolve(src, dst, rect, k, 0);
  },
});

export const EFFECT_MENUS = ['Artistic', 'Blurs', 'Distort', 'Noise', 'Object', 'Photo', 'Render', 'Stylize'];

export function defaultParams(fx) {
  const o = {};
  for (const p of fx.params || []) o[p.key] = typeof p.def === 'object' ? JSON.parse(JSON.stringify(p.def)) : p.def;
  return o;
}

export function runEffect(id, src, rect, params, env) {
  const fx = EFFECTS[id];
  const dst = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
  fx.render(src, dst, rect, params, env);
  return dst;
}

export { histogramLevels };
