import { test, expect } from './fixtures.js';

// Reference blend functions (W3C compositing spec, values 0..1)
const REF = {
  normal: (b, s) => s, multiply: (b, s) => b * s, screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  darken: Math.min, lighten: Math.max, difference: (b, s) => Math.abs(b - s),
  colordodge: (b, s) => (b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s))),
  colorburn: (b, s) => (b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  hardlight: (b, s) => (s <= 0.5 ? b * 2 * s : 1 - (1 - b) * (1 - (2 * s - 1))),
  additive: (b, s) => Math.min(1, b + s),
  reflect: (b, s) => (s >= 1 ? 1 : Math.min(1, (b * b) / (1 - s))),
  glow: (b, s) => (b >= 1 ? 1 : Math.min(1, (s * s) / (1 - b))),
  negation: (b, s) => 1 - Math.abs(1 - b - s),
  xor: (b, s) => (((b * 255) | 0) ^ ((s * 255) | 0)) / 255,
};

for (const [mode, fn] of Object.entries(REF)) {
  test(`layer blend mode ${mode} matches the reference formula`, async ({ app }) => {
    await app.newDoc(4, 1, '#000000');
    const result = await app.eval((mode) => {
      const d = pdn.activeDoc;
      const base = [[200, 100, 50], [30, 60, 90], [128, 128, 128], [250, 10, 180]];
      const top = [[100, 200, 150], [220, 40, 128], [64, 192, 255], [0, 255, 77]];
      base.forEach(([r, g, b], x) => { d.layers[0].ctx.fillStyle = `rgb(${r},${g},${b})`; d.layers[0].ctx.fillRect(x, 0, 1, 1); });
      pdn.run('layers.add');
      const l = d.layers[1];
      top.forEach(([r, g, b], x) => { l.ctx.fillStyle = `rgb(${r},${g},${b})`; l.ctx.fillRect(x, 0, 1, 1); });
      l.blendMode = mode;
      d.invalidate();
      return { base, top, out: [...d.getComposite().getContext('2d').getImageData(0, 0, 4, 1).data] };
    }, mode);
    for (let x = 0; x < 4; x++) for (let k = 0; k < 3; k++) {
      const exp = Math.round(fn(result.base[x][k] / 255, result.top[x][k] / 255) * 255);
      expect(Math.abs(result.out[x * 4 + k] - exp), `${mode} px${x} ch${k}: got ${result.out[x * 4 + k]} expected ${exp}`).toBeLessThanOrEqual(3);
    }
  });
}

test('layer opacity, visibility and properties dialog with undo', async ({ app, page }) => {
  await app.newDoc(10, 10, '#000000');
  await app.eval(() => { pdn.run('layers.add'); const l = pdn.activeDoc.layers[1]; l.ctx.fillStyle = '#fff'; l.ctx.fillRect(0, 0, 10, 10); pdn.activeDoc.invalidate(); });
  const before = await app.sig(), base = await app.histIndex();
  await app.run('layers.properties');
  const dlg = page.locator('.dialog');
  await dlg.locator('input.text').fill('My Layer');
  await dlg.locator('input.num').fill('128');
  await dlg.locator('input.num').press('Tab');
  await app.okDialog();
  const c = await app.px(5, 5);
  expect(Math.abs(c[0] - 128)).toBeLessThanOrEqual(1);
  expect(await app.eval(() => pdn.activeDoc.layers[1].name)).toBe('My Layer');
  // visibility checkbox in the Layers window creates history
  await page.locator('.layer-item').first().locator('.layer-vis').click();
  expect(await app.px(5, 5)).toEqual([0, 0, 0, 255]);
  expect((await app.hist()).slice(-1)[0]).toBe('Layer Hidden');
  const after = await app.sig();
  await app.checkUndoRedo(before, after, base);
});

test('layer properties dialog cancel restores everything', async ({ app, page }) => {
  await app.run('layers.add');
  const before = await app.sig();
  await app.run('layers.properties');
  const dlg = page.locator('.dialog');
  await dlg.locator('input.text').fill('Changed');
  await dlg.locator('select').selectOption('multiply');
  await dlg.locator('label.check input').uncheck();
  await app.cancelDialog();
  expect(await app.sig()).toBe(before);
});

test('merge down respects the upper layer blend mode and opacity', async ({ app }) => {
  await app.newDoc(2, 1, '#808080');
  await app.eval(() => {
    pdn.run('layers.add');
    const l = pdn.activeDoc.layers[1];
    l.ctx.fillStyle = '#ff0000'; l.ctx.fillRect(0, 0, 2, 1);
    l.opacity = 128; l.blendMode = 'multiply';
    pdn.activeDoc.invalidate();
  });
  const comp = await app.px(0, 0);
  await app.run('layers.merge');
  expect(await app.eval(() => pdn.activeDoc.layers.length)).toBe(1);
  const merged = await app.px(0, 0, 0);
  merged.forEach((v, i) => expect(Math.abs(v - comp[i])).toBeLessThanOrEqual(1));
});

test('drag and drop reorders layers in the Layers window', async ({ app, page }) => {
  await app.run('layers.add');
  await app.run('layers.add');
  const names = () => app.eval(() => pdn.activeDoc.layers.map((l) => l.name));
  expect(await names()).toEqual(['Background', 'Layer 2', 'Layer 3']);
  const items = page.locator('.layer-item');
  await items.nth(0).dragTo(items.nth(2));
  expect(await names()).toEqual(['Layer 3', 'Background', 'Layer 2']);
  await app.run('edit.undo');
  expect(await names()).toEqual(['Background', 'Layer 2', 'Layer 3']);
});

test('rotate/zoom layer dialog applies and cancels', async ({ app, page }) => {
  await app.eval(() => { const c = pdn.activeDoc.layers[0].ctx; c.fillStyle = '#f00'; c.fillRect(0, 0, 400, 600); pdn.activeDoc.invalidate(); });
  const before = await app.sig();
  await app.run('layers.rotatezoom');
  await page.locator('.dialog input.num').first().fill('90');
  await page.locator('.dialog input.num').first().press('Tab');
  await app.cancelDialog();
  expect(await app.sig()).toBe(before);
  await app.run('layers.rotatezoom');
  await page.locator('.dialog input.num').first().fill('180');
  await page.locator('.dialog input.num').first().press('Tab');
  await app.okDialog();
  expect(await app.px(700, 300)).toEqual([255, 0, 0, 255]);
  await app.checkUndoRedo(before, await app.sig());
});
