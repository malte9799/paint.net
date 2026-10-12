// Image format codecs: ZIP (for OpenRaster), ORA, BMP, TGA.
import { createCanvas, canvasToBlob, blobToCanvas } from './util.js';

// ---------- CRC32 / ZIP ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{name, data: Uint8Array}] — stored without compression (PNG data is already compressed).
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true);
    ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export async function unzip(buffer) {
  const v = new DataView(buffer), u8 = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const lnlen = v.getUint16(lho + 26, true), lxlen = v.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lxlen;
    const raw = u8.slice(start, start + csize);
    out.set(name, { method, raw });
    p += 46 + nlen + xlen + clen;
  }
  return {
    has: (name) => out.has(name),
    names: () => [...out.keys()],
    async bytes(name) {
      const e = out.get(name);
      if (!e) return null;
      if (e.method === 0) return e.raw;
      if (e.method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const buf = await new Response(new Blob([e.raw]).stream().pipeThrough(ds)).arrayBuffer();
        return new Uint8Array(buf);
      }
      throw new Error('Unsupported ZIP compression');
    },
  };
}

// ---------- OpenRaster ----------
const ORA_OPS = {
  normal: 'svg:src-over', multiply: 'svg:multiply', additive: 'svg:plus', colorburn: 'svg:color-burn',
  colordodge: 'svg:color-dodge', overlay: 'svg:overlay', difference: 'svg:difference', lighten: 'svg:lighten',
  darken: 'svg:darken', screen: 'svg:screen', hardlight: 'svg:hard-light', softlight: 'svg:soft-light',
  color: 'svg:color', luminosity: 'svg:luminosity', hue: 'svg:hue', saturation: 'svg:saturation',
  reflect: 'pdn:reflect', glow: 'pdn:glow', negation: 'pdn:negation', xor: 'pdn:xor',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export async function encodeORA(doc) {
  const files = [{ name: 'mimetype', data: new TextEncoder().encode('image/openraster') }];
  const bytes = async (canvas) => new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer());
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${doc.width}" h="${doc.height}" xres="${doc.dpi}" yres="${doc.dpi}">\n<stack>\n`;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    const src = `data/layer${i}.png`;
    files.push({ name: src, data: await bytes(l.canvas) });
    xml += `<layer name="${esc(l.name)}" src="${src}" x="0" y="0" opacity="${(l.opacity / 255).toFixed(4)}" visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="${ORA_OPS[l.blendMode] || 'svg:src-over'}"/>\n`;
  }
  xml += '</stack>\n</image>\n';
  files.splice(1, 0, { name: 'stack.xml', data: new TextEncoder().encode(xml) });
  const merged = doc.flatten();
  files.push({ name: 'mergedimage.png', data: await bytes(merged) });
  const s = Math.min(1, 256 / Math.max(doc.width, doc.height));
  const th = createCanvas(doc.width * s, doc.height * s);
  th.getContext('2d').drawImage(merged, 0, 0, th.width, th.height);
  files.push({ name: 'Thumbnails/thumbnail.png', data: await bytes(th) });
  return zipStore(files);
}

// Returns {width, height, dpi, layers:[{name, visible, opacity, blendMode, canvas}]}
export async function decodeORA(buffer) {
  const z = await unzip(buffer);
  const xmlBytes = await z.bytes('stack.xml');
  if (!xmlBytes) throw new Error('Invalid OpenRaster file (missing stack.xml)');
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), 'application/xml');
  const img = xml.querySelector('image');
  const width = parseInt(img.getAttribute('w')), height = parseInt(img.getAttribute('h'));
  const dpi = parseFloat(img.getAttribute('xres')) || 96;
  const rev = Object.fromEntries(Object.entries(ORA_OPS).map(([k, v]) => [v, k]));
  const layers = [];
  for (const el of [...xml.querySelectorAll('layer')].reverse()) {
    const data = await z.bytes(el.getAttribute('src'));
    if (!data) continue;
    const src = await blobToCanvas(new Blob([data], { type: 'image/png' }));
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(src, parseFloat(el.getAttribute('x')) || 0, parseFloat(el.getAttribute('y')) || 0);
    layers.push({
      name: el.getAttribute('name') || 'Layer',
      visible: el.getAttribute('visibility') !== 'hidden',
      opacity: Math.round((parseFloat(el.getAttribute('opacity') ?? '1')) * 255),
      blendMode: rev[el.getAttribute('composite-op')] || 'normal',
      canvas,
    });
  }
  return { width, height, dpi, layers };
}

// ---------- BMP ----------
export function encodeBMP(canvas) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let hasAlpha = false;
  for (let i = 3; i < src.length; i += 4) if (src[i] !== 255) { hasAlpha = true; break; }
  const bpp = hasAlpha ? 32 : 24;
  const rowSize = Math.ceil((w * bpp) / 32) * 4;
  const headerSize = hasAlpha ? 108 : 40;
  const dataOffset = 14 + headerSize;
  const buf = new ArrayBuffer(dataOffset + rowSize * h);
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  v.setUint16(0, 0x4d42, true); v.setUint32(2, buf.byteLength, true); v.setUint32(10, dataOffset, true);
  v.setUint32(14, headerSize, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, bpp, true); v.setUint32(30, hasAlpha ? 3 : 0, true);
  v.setUint32(34, rowSize * h, true); v.setInt32(38, 3780, true); v.setInt32(42, 3780, true);
  if (hasAlpha) {
    v.setUint32(54, 0x00ff0000, true); v.setUint32(58, 0x0000ff00, true);
    v.setUint32(62, 0x000000ff, true); v.setUint32(66, 0xff000000, true);
    v.setUint32(70, 0x73524742, true); // 'sRGB'
  }
  for (let y = 0; y < h; y++) {
    let p = dataOffset + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      u8[p++] = src[i + 2]; u8[p++] = src[i + 1]; u8[p++] = src[i];
      if (hasAlpha) u8[p++] = src[i + 3];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

// ---------- TGA ----------
export function encodeTGA(canvas) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const buf = new Uint8Array(18 + w * h * 4 + 26);
  buf[2] = 2; // uncompressed true-color
  buf[12] = w & 255; buf[13] = w >> 8; buf[14] = h & 255; buf[15] = h >> 8;
  buf[16] = 32; buf[17] = 0x28; // 8 alpha bits, top-left origin
  let p = 18;
  for (let i = 0; i < src.length; i += 4) {
    buf[p++] = src[i + 2]; buf[p++] = src[i + 1]; buf[p++] = src[i]; buf[p++] = src[i + 3];
  }
  // TGA 2.0 footer
  buf.set(new TextEncoder().encode('TRUEVISION-XFILE.\0'), p + 8);
  return new Blob([buf], { type: 'image/x-tga' });
}

export function decodeTGA(buffer) {
  const u8 = new Uint8Array(buffer);
  const idLen = u8[0], cmapType = u8[1], type = u8[2];
  const cmapLen = u8[5] | (u8[6] << 8), cmapDepth = u8[7];
  const w = u8[12] | (u8[13] << 8), h = u8[14] | (u8[15] << 8);
  const bpp = u8[16], desc = u8[17];
  if (![1, 2, 3, 9, 10, 11].includes(type)) throw new Error('Unsupported TGA type');
  let p = 18 + idLen;
  let cmap = null;
  if (cmapType === 1) { cmap = u8.subarray(p, p + cmapLen * (cmapDepth >> 3)); p += cmapLen * (cmapDepth >> 3); }
  const bytesPP = bpp >> 3;
  const pixels = new Uint8Array(w * h * bytesPP);
  if (type >= 9) {
    let o = 0;
    while (o < pixels.length) {
      const hdr = u8[p++], n = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        for (let k = 0; k < n; k++) for (let b = 0; b < bytesPP; b++) pixels[o++] = u8[p + b];
        p += bytesPP;
      } else {
        const len = n * bytesPP;
        pixels.set(u8.subarray(p, p + len), o); o += len; p += len;
      }
    }
  } else pixels.set(u8.subarray(p, p + pixels.length));
  const c = createCanvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const topDown = desc & 0x20;
  const cBytes = cmapDepth >> 3;
  for (let y = 0; y < h; y++) {
    const ty = topDown ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * bytesPP, o = (ty * w + x) * 4;
      let r, g, b, a = 255;
      if (type === 1 || type === 9) {
        const idx = pixels[s] * cBytes;
        b = cmap[idx]; g = cmap[idx + 1]; r = cmap[idx + 2]; if (cBytes === 4) a = cmap[idx + 3];
      } else if (type === 3 || type === 11) { r = g = b = pixels[s]; if (bytesPP === 2) a = pixels[s + 1]; }
      else if (bytesPP === 2) {
        const v = pixels[s] | (pixels[s + 1] << 8);
        r = ((v >> 10) & 31) * 8.226; g = ((v >> 5) & 31) * 8.226; b = (v & 31) * 8.226;
      } else { b = pixels[s]; g = pixels[s + 1]; r = pixels[s + 2]; if (bytesPP === 4) a = pixels[s + 3]; }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
    }
  }
  // Some writers emit 32-bit TGAs with an all-zero alpha channel.
  if (bytesPP === 4 && !(desc & 0x0f)) for (let i = 3; i < d.length; i += 4) d[i] = 255;
  ctx.putImageData(img, 0, 0);
  return c;
}

export { canvasToBlob };
