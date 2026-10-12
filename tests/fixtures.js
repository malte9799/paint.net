// Shared fixture: opens the app in a fresh context, exposes helpers and fails the
// test if the page logs any error (uncaught exceptions, console.error, failed modules).
import { test as base, expect } from '@playwright/test';

const IGNORED = [/willReadFrequently/, /System clipboard unavailable/, /Write permission denied/, /Read permission denied/];

export const test = base.extend({
  app: async ({ page }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '')));
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !IGNORED.some((r) => r.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`);
    });
    page.on('requestfailed', (r) => { if (!r.url().includes('favicon')) errors.push('requestfailed: ' + r.url()); });
    const app = new AppDriver(page, errors);
    await app.open();
    await use(app);
    if (!testInfo.annotations.some((a) => a.type === 'allow-errors')) expect(errors, 'page errors').toEqual([]);
  },
});
export { expect };

export class AppDriver {
  constructor(page, errors) { this.page = page; this.errors = errors; }

  async open(path = '/') {
    await this.page.goto(path);
    await this.page.waitForFunction(() => window.pdn && window.pdn.activeDoc !== undefined && document.querySelector('.menu-top'));
    await this.page.waitForTimeout(200);
  }
  eval(fn, arg) { return this.page.evaluate(fn, arg); }

  // Run a command without awaiting it (commands that open dialogs resolve only when closed).
  async run(id) {
    await this.page.evaluate((id) => { window.__lastRun = pdn.run(id); }, id);
    await this.page.waitForTimeout(60);
  }
  async runAndWait(id) {
    await this.run(id);
    await this.page.evaluate(() => window.__lastRun);
  }
  dialogOpen() { return this.page.locator('.dialog').count().then((n) => n > 0); }
  async okDialog() { await this.page.locator('.dialog .btn.primary').last().click(); await this.page.waitForTimeout(80); }
  async cancelDialog() { await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(80); }

  // New blank document of a given size via the API (no dialog)
  async newDoc(w = 400, h = 300, bg = '#ffffff') {
    await this.eval(async ([w, h, bg]) => {
      const { Document } = await import('./js/document.js');
      pdn.addDocument(new Document(w, h, { background: bg }));
    }, [w, h, bg]);
  }

  // Signature of the current document: size, layer count/props and a pixel hash per layer
  sig() {
    return this.eval(() => {
      const d = pdn.activeDoc;
      if (!d) return 'nodoc';
      const hash = (c) => {
        const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let h = 2166136261;
        for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619);
        return (h >>> 0).toString(36);
      };
      return JSON.stringify({
        w: d.width, h: d.height, active: d.activeIndex,
        layers: d.layers.map((l) => [l.name, l.visible, l.opacity, l.blendMode, l.canvas.width, l.canvas.height, hash(l.canvas)]),
        sel: d.selection.empty ? null : d.selection.bounds,
      });
    });
  }
  px(x, y, layer = null) {
    return this.eval(([x, y, layer]) => {
      const d = pdn.activeDoc;
      const c = layer == null ? d.getComposite() : d.layers[layer].canvas;
      return [...c.getContext('2d').getImageData(x, y, 1, 1).data];
    }, [x, y, layer]);
  }
  hist() { return this.eval(() => pdn.activeDoc.history.items.map((i) => i.name)); }

  async toClient(x, y) {
    const box = await this.page.locator('canvas.display').boundingBox();
    const s = await this.eval(([x, y]) => pdn.view.toScreen(x, y), [x, y]);
    return { x: box.x + s.x, y: box.y + s.y };
  }
  async drag(points, { button = 'left', modifiers = [], steps = 6 } = {}) {
    for (const m of modifiers) await this.page.keyboard.down(m);
    let p = await this.toClient(...points[0]);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.down({ button });
    for (const q of points.slice(1)) { p = await this.toClient(...q); await this.page.mouse.move(p.x, p.y, { steps }); }
    await this.page.mouse.up({ button });
    for (const m of modifiers) await this.page.keyboard.up(m);
  }
  async click(x, y, opts = {}) { await this.drag([[x, y]], opts); }
  async tool(id) { await this.eval((id) => pdn.setTool(id), id); }
  async setting(key, value) { await this.eval(([k, v]) => pdn.setToolSetting(k, v), [key, value]); }
  async primary(c) { await this.eval((c) => pdn.setPrimary(c), c); }
  async secondary(c) { await this.eval((c) => pdn.setSecondary(c), c); }
  async selectRect(x, y, w, h) {
    await this.eval(([x, y, w, h]) => {
      const d = pdn.activeDoc;
      d.selection.setRect({ x, y, w, h });
      d.emit('selection');
    }, [x, y, w, h]);
  }
  // Undo everything and redo everything, checking the signatures match.
  histIndex() { return this.eval(() => pdn.activeDoc.history.current); }
  async checkUndoRedo(before, after, baseIndex = 0) {
    await this.eval((i) => { pdn.commitTool(); pdn.activeDoc.history.goto(i); }, baseIndex);
    expect(await this.sig(), 'undo all returns to initial state').toBe(before);
    await this.eval(() => pdn.activeDoc.history.goto(1e9));
    expect(await this.sig(), 'redo all returns to final state').toBe(after);
  }
}

// Paint something recognizable on the active layer via the API
export async function paintSample(app) {
  await app.eval(() => {
    const l = pdn.activeDoc.activeLayer, c = l.ctx;
    c.fillStyle = '#e03030'; c.fillRect(20, 20, 120, 80);
    c.fillStyle = '#3060e0'; c.beginPath(); c.arc(220, 150, 60, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(40,160,60,0.5)'; c.fillRect(100, 180, 200, 60);
    pdn.activeDoc.invalidate();
  });
}
