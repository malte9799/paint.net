import { runEffect } from './registry.js';

let cached = null; // {key, src}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.src) cached = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.src) };
    const out = runEffect(m.effect, cached, m.rect, m.params, m.env);
    self.postMessage({ id: m.id, data: out.data.buffer }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.stack || err) });
  }
};
