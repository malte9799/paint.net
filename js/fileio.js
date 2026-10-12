import { Document, Layer } from './document.js';
import { blobToCanvas, canvasToBlob, downloadBlob, fileExt, stripExt } from './util.js';
import { encodeORA, decodeORA, encodeBMP, encodeTGA, decodeTGA } from './formats.js';
import { Dialog, sliderRow, selectBox, messageBox, confirmBox } from './ui/dialog.js';
import { h } from './ui/dom.js';
import { recordDocOp } from './history.js';
import { addRecent } from './storage.js';

export const FORMATS = [
  { id: 'png', name: 'PNG', exts: ['png'], mime: 'image/png' },
  { id: 'jpg', name: 'JPEG', exts: ['jpg', 'jpeg', 'jpe', 'jfif'], mime: 'image/jpeg', quality: true },
  { id: 'webp', name: 'WebP', exts: ['webp'], mime: 'image/webp', quality: true },
  { id: 'bmp', name: 'BMP', exts: ['bmp', 'dib'], mime: 'image/bmp' },
  { id: 'tga', name: 'TGA', exts: ['tga'], mime: 'image/x-tga' },
  { id: 'ora', name: 'OpenRaster (layered)', exts: ['ora'], mime: 'image/openraster', layered: true },
];
export const OPEN_ACCEPT = '.png,.jpg,.jpeg,.jpe,.jfif,.gif,.webp,.bmp,.dib,.ico,.avif,.svg,.tga,.ora,image/*';

export const formatByExt = (ext) => FORMATS.find((f) => f.exts.includes(ext));

// ---------- Opening ----------
export async function readImageFile(file, name = file.name) {
  const ext = fileExt(name);
  if (ext === 'ora') {
    const o = await decodeORA(await file.arrayBuffer());
    const doc = new Document(o.width, o.height, { name, dpi: o.dpi, baseName: 'Open Image', baseIcon: 'open', fileType: 'ora' });
    for (const l of o.layers) {
      const layer = Layer.fromCanvas(l.canvas, l.name);
      Object.assign(layer, { visible: l.visible, opacity: l.opacity, blendMode: l.blendMode });
      doc.layers.push(layer);
    }
    doc.activeIndex = doc.layers.length - 1;
    return doc;
  }
  const canvas = ext === 'tga' ? decodeTGA(await file.arrayBuffer()) : await blobToCanvas(file);
  const doc = new Document(canvas.width, canvas.height, { name, baseName: 'Open Image', baseIcon: 'open', fileType: formatByExt(ext)?.id || 'png' });
  doc.layers.push(Layer.fromCanvas(canvas, 'Background'));
  return doc;
}

export async function pickFiles({ multiple = true } = {}) {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple,
        types: [{ description: 'All images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.webp', '.bmp', '.dib', '.ico', '.avif', '.tga', '.ora'] } }],
      });
      return Promise.all(handles.map(async (hd) => ({ file: await hd.getFile(), handle: hd })));
    } catch (e) {
      if (e.name === 'AbortError') return [];
      // fall through to <input>
    }
  }
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: OPEN_ACCEPT, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve([...inp.files].map((file) => ({ file, handle: null }))); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

export async function openFiles(app, entries) {
  for (const { file, handle } of entries) {
    try {
      const doc = await readImageFile(file);
      doc.fileHandle = handle;
      doc.markSaved();
      app.addDocument(doc);
      addRecent(doc);
    } catch (e) {
      console.error(e);
      await messageBox(`There was an error opening "${file.name}".\n\n${e.message || e}`, { icon: 'warning' });
    }
  }
}

// ---------- Saving ----------
async function encode(doc, fmt, opts) {
  if (fmt.id === 'ora') return encodeORA(doc);
  const flat = doc.flatten();
  if (fmt.id === 'bmp') return encodeBMP(flat);
  if (fmt.id === 'tga') return encodeTGA(flat);
  if (fmt.id === 'jpg') {
    // JPEG has no alpha: composite onto white like paint.net does
    const c = document.createElement('canvas');
    c.width = flat.width; c.height = flat.height;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(flat, 0, 0);
    return canvasToBlob(c, 'image/jpeg', opts.quality / 100);
  }
  return canvasToBlob(flat, fmt.mime, fmt.quality ? opts.quality / 100 : undefined);
}

async function saveConfig(fmt, doc) {
  if (!fmt.quality) return {};
  let q = doc._saveQuality || 95;
  const preview = h('div.save-size', '');
  const update = async () => {
    try { const b = await encode(doc, fmt, { quality: q }); preview.textContent = `File size: ${(b.size / 1024).toFixed(1)} KB`; } catch {}
  };
  const row = sliderRow({ label: 'Quality', value: q, min: 1, max: 100, def: 95, onInput: (v) => { q = v; clearTimeout(t); t = setTimeout(update, 200); } });
  let t = setTimeout(update, 50);
  const res = await new Dialog({ title: 'Save Configuration', icon: 'save', content: h('div.form', row.el, preview), width: 360 }).show();
  if (res !== 'ok') return null;
  doc._saveQuality = q;
  return { quality: q };
}

async function ensureFlattenable(app, doc, fmt) {
  if (fmt.layered || doc.layers.length === 1) return true;
  const ok = await confirmBox('Saving to this file format requires the image to be flattened. Flattening merges all layers into a single layer.', { title: 'Flatten', yes: 'Flatten', no: 'Cancel' });
  if (!ok) return false;
  app.run('image.flatten');
  return true;
}

// Save-as dialog used when the File System Access API is unavailable.
async function saveAsDialog(doc) {
  const name = h('input.text', { type: 'text', value: stripExt(doc.name) });
  const cur = doc.fileType && FORMATS.find((f) => f.id === doc.fileType) ? doc.fileType : doc.layers.length > 1 ? 'ora' : 'png';
  const type = selectBox({ options: FORMATS.map((f) => [f.id, `${f.name} (*.${f.exts.join(', *.')})`]), value: cur });
  const content = h('div.form.saveas-form', h('label', 'File name:'), name, h('label', 'Save as type:'), type.el,
    h('div.hint', 'The file will be downloaded by your browser.'));
  const res = await new Dialog({ title: 'Save As', icon: 'saveas', content, width: 420, buttons: [{ label: 'Save', value: 'ok', primary: true }, { label: 'Cancel', value: 'cancel', cancel: true }] }).show();
  if (res !== 'ok') return null;
  const fmt = FORMATS.find((f) => f.id === type.value);
  let n = name.value.trim() || 'Untitled';
  if (!fmt.exts.includes(fileExt(n))) n += '.' + fmt.exts[0];
  return { name: n, fmt, handle: null };
}

export async function saveDocument(app, doc, saveAs = false) {
  app.commitTool();
  let target;
  const canQuickSave = !saveAs && doc.fileHandle && doc.fileType;
  if (canQuickSave) {
    target = { name: doc.name, fmt: FORMATS.find((f) => f.id === doc.fileType), handle: doc.fileHandle };
  } else if (window.showSaveFilePicker) {
    const preferred = doc.layers.length > 1 ? 'ora' : doc.fileType || 'png';
    const ordered = [FORMATS.find((f) => f.id === preferred), ...FORMATS.filter((f) => f.id !== preferred)].filter(Boolean);
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: stripExt(doc.name) + '.' + ordered[0].exts[0],
        types: ordered.map((f) => ({ description: f.name, accept: { [f.mime]: f.exts.map((e) => '.' + e) } })),
      });
    } catch (e) {
      if (e.name === 'AbortError') return false;
      target = await saveAsDialog(doc);
    }
    if (handle) {
      const fmt = formatByExt(fileExt(handle.name)) || FORMATS[0];
      target = { name: handle.name, fmt, handle };
    }
  } else {
    target = await saveAsDialog(doc);
  }
  if (!target) return false;
  if (!(await ensureFlattenable(app, doc, target.fmt))) return false;
  const opts = canQuickSave && doc._saveQuality ? { quality: doc._saveQuality } : await saveConfig(target.fmt, doc);
  if (!opts) return false;
  app.setBusy(true);
  try {
    const blob = await encode(doc, target.fmt, opts);
    if (target.handle) {
      const w = await target.handle.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      downloadBlob(blob, target.name);
    }
    doc.name = target.name;
    doc.fileType = target.fmt.id;
    doc.fileHandle = target.handle;
    doc.markSaved();
    app.emit('docs');
    addRecent(doc);
    return true;
  } catch (e) {
    console.error(e);
    await messageBox('There was an error saving the file.\n\n' + (e.message || e), { icon: 'warning' });
    return false;
  } finally {
    app.setBusy(false);
  }
}

export { recordDocOp };
