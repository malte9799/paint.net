import { clamp } from './util.js';

export const rgba = (r, g, b, a = 255) => ({ r, g, b, a });
export const BLACK = rgba(0, 0, 0);
export const WHITE = rgba(255, 255, 255);

export function toCss(c, alpha = true) {
  return alpha ? `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(4)})` : `rgb(${c.r},${c.g},${c.b})`;
}

const hx = (n) => n.toString(16).padStart(2, '0').toUpperCase();
export function toHex(c, withAlpha = false) {
  return hx(c.r) + hx(c.g) + hx(c.b) + (withAlpha ? hx(c.a) : '');
}

export function fromHex(s) {
  s = String(s).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((ch) => ch + ch).join('');
  if (/^[0-9a-f]{6}$/i.test(s)) s += 'FF';
  if (!/^[0-9a-f]{8}$/i.test(s)) return null;
  const n = (i) => parseInt(s.substr(i, 2), 16);
  return rgba(n(0), n(2), n(4), n(6));
}

// h: 0..360, s/v: 0..100
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? (d / max) * 100 : 0, v: max * 100 };
}

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; v = clamp(v, 0, 100) / 100;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255) };
}

export const colorEq = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
export const luma = (r, g, b) => (r * 0.299 + g * 0.587 + b * 0.114);

// The default paint.net palette: 96 swatches.
export function defaultPalette() {
  const hues = ['FF0000', 'FF6A00', 'FFD800', 'B6FF00', '4CFF00', '00FF21', '00FF90', '00FFFF', '0094FF', '0026FF', '4800FF', 'B200FF', 'FF00DC', 'FF006E'];
  const scale = (hex, f, toward = 0) => {
    const c = typeof hex === 'string' ? fromHex(hex) : hex;
    const m = (v) => Math.round(toward ? v + (255 - v) * f : v * f);
    return rgba(m(c.r), m(c.g), m(c.b));
  };
  const rows = [
    ['000000', '404040', ...hues.map((h) => toHex(fromHex(h)))],
    ['FFFFFF', '808080', ...hues.map((h) => toHex(scale(h, 0.5)))],
    ['A0A0A0', '303030', ...hues.map((h) => toHex(scale(h, 0.5, 1)))],
    ['C0C0C0', '606060', ...hues.map((h) => toHex(scale(scale(h, 0.5, 1), 0.5)))],
  ];
  const out = [];
  for (const row of rows) for (const h of row) out.push(fromHex(h));
  // Two translucent rows
  for (const row of rows.slice(0, 2)) for (const h of row) { const c = fromHex(h); c.a = 128; out.push(c); }
  return out;
}
