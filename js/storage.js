import { Emitter, canvasToBlob, blobToCanvas, debounce } from './util.js';
import { Document, Layer } from './document.js';

// ---------- localStorage settings ----------
const LS_KEY = 'pdnweb.settings.v1';

class SettingsStore extends Emitter {
  constructor() {
    super();
    this.data = {};
    try { this.data = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { this.data = {}; }
    this._save = debounce(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch { /* quota / private mode */ }
    }, 250);
  }
  get(key, def) { return key in this.data ? this.data[key] : def; }
  set(key, value) {
    this.data[key] = value;
    this._save();
    this.emit('change', key, value);
  }
  reset() {
    this.data = {};
    try { localStorage.removeItem(LS_KEY); } catch {}
    this.emit('change', '*');
  }
}
export const Settings = new SettingsStore();

// ---------- IndexedDB ----------
const DB_NAME = 'paintnet-web';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('recent')) db.createObjectStore('recent', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => res(result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  getAll: (store) => tx(store, 'readonly', (s) => s.getAll()),
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
  delete: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
};

// ---------- document (de)serialization ----------
export async function serializeDoc(doc, extra = {}) {
  const layers = [];
  for (const l of doc.layers) {
    layers.push({
      name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode,
      blob: await canvasToBlob(l.canvas, 'image/png'),
    });
  }
  return {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    activeIndex: doc.activeIndex,
    fileType: doc.fileType,
    dirty: doc.dirty,
    layers,
    time: Date.now(),
    ...extra,
  };
}

export async function deserializeDoc(rec, opts = {}) {
  const doc = new Document(rec.width, rec.height, {
    id: opts.newId ? undefined : rec.id, name: rec.name, dpi: rec.dpi, fileType: rec.fileType,
    baseName: opts.baseName || 'Open Image', baseIcon: 'open',
  });
  for (const ld of rec.layers) {
    const canvas = await blobToCanvas(ld.blob);
    const l = Layer.fromCanvas(canvas, ld.name);
    l.visible = ld.visible; l.opacity = ld.opacity; l.blendMode = ld.blendMode || 'normal';
    doc.layers.push(l);
  }
  doc.activeIndex = Math.min(rec.activeIndex || 0, doc.layers.length - 1);
  if (rec.dirty) doc.markDirty();
  return doc;
}

// ---------- recent files ----------
const MAX_RECENT = 10;

export async function addRecent(doc) {
  try {
    const rec = await serializeDoc(doc);
    rec.id = 'recent:' + doc.name;
    const t = doc.thumbnail(96);
    rec.thumb = await canvasToBlob(t, 'image/png');
    rec.dirty = false;
    await idb.put('recent', rec);
    const all = (await idb.getAll('recent')).sort((a, b) => b.time - a.time);
    for (const old of all.slice(MAX_RECENT)) await idb.delete('recent', old.id);
  } catch (e) { console.warn('Could not store recent file', e); }
}

export async function listRecent() {
  try { return (await idb.getAll('recent')).sort((a, b) => b.time - a.time); } catch { return []; }
}
