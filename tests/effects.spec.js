import { test, expect, paintSample } from './fixtures.js';

async function effectIds(app) {
  return app.eval(async () => { const { EFFECTS } = await import('./js/effects/registry.js'); return Object.values(EFFECTS).map((f) => ({ id: f.id, params: !!(f.params && f.params.length) })); });
}

test('every effect via its dialog changes only pixels inside the selection', async ({ app }) => {
  test.setTimeout(300_000);
  await paintSample(app);
  const list = await effectIds(app);
  const outsideHash = () => app.eval(() => {
    const d = pdn.activeDoc.layers[0].ctx.getImageData(0, 0, 800, 600).data;
    let h = 0;
    for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) {
      if (x >= 60 && x < 260 && y >= 40 && y < 200) continue;
      const i = (y * 800 + x) * 4;
      h = (Math.imul(h, 31) + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) | 0;
    }
    return h;
  });
  await app.selectRect(60, 40, 200, 160);
  const out0 = await outsideHash();
  for (const fx of list) {
    const h0 = (await app.hist()).length;
    await app.run('fx.' + fx.id);
    if (fx.params) {
      await expect(app.page.locator('.dialog')).toBeVisible();
      await app.page.waitForTimeout(150);
      await app.okDialog();
    }
    await expect.poll(() => app.hist().then((h) => h.length), { message: fx.id }).toBe(h0 + 1);
    expect(await outsideHash(), `${fx.id} changed pixels outside the selection`).toBe(out0);
  }
});

test('cancelling an effect dialog restores the image exactly', async ({ app }) => {
  await paintSample(app);
  const before = await app.sig();
  for (const id of ['gaussianblur', 'twist', 'curves', 'levels', 'clouds', 'huesaturation']) {
    await app.run('fx.' + id);
    await app.page.waitForTimeout(400);
    await app.cancelDialog();
    await app.page.waitForTimeout(150);
    expect(await app.sig(), id).toBe(before);
  }
  expect(await app.hist()).toEqual(['New Image']);
});

test('changing a slider updates the preview, OK applies the final value', async ({ app, page }) => {
  await paintSample(app);
  await app.run('fx.gaussianblur');
  const num = page.locator('.dialog input.num').first();
  await num.fill('15');
  await num.press('Tab');
  await page.waitForTimeout(600);
  const preview = await app.sig();
  await app.okDialog();
  await expect.poll(() => app.hist()).toContain('Gaussian Blur');
  expect(await app.sig()).toBe(preview);
  // Ctrl+F repeats with the same parameters
  await page.locator('canvas.display').focus();
  await page.keyboard.press('Control+f');
  await expect.poll(() => app.hist().then((h) => h.length)).toBe(3);
});

test('effects work on a 1x1 image and on a fully transparent layer', async ({ app }) => {
  test.setTimeout(240_000);
  const list = await effectIds(app);
  await app.newDoc(1, 1, '#808080');
  for (const fx of list) await app.eval(async (id) => { const { runEffectCommand } = await import('./js/effects/runner.js'); await runEffectCommand(pdn, id, { repeat: true }); }, fx.id);
  expect((await app.hist()).length).toBe(list.length + 1);
  await app.newDoc(64, 48, null);
  for (const fx of list) await app.eval(async (id) => { const { runEffectCommand } = await import('./js/effects/runner.js'); await runEffectCommand(pdn, id, { repeat: true }); }, fx.id);
  const nan = await app.eval(() => { const d = pdn.activeDoc.layers[0].ctx.getImageData(0, 0, 64, 48).data; return d.some((v) => Number.isNaN(v)); });
  expect(nan).toBe(false);
});

test('effect registry: pure functions are deterministic and bounded', async ({ app }) => {
  const res = await app.eval(async () => {
    const { EFFECTS, runEffect, defaultParams } = await import('./js/effects/registry.js');
    const W = 40, H = 30, data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
    const env = { primary: { r: 0, g: 0, b: 0, a: 255 }, secondary: { r: 255, g: 255, b: 255, a: 255 }, sel: { x: 0, y: 0, w: W, h: H } };
    const out = [];
    for (const fx of Object.values(EFFECTS)) {
      const a = runEffect(fx.id, { width: W, height: H, data: new Uint8ClampedArray(data) }, { x: 5, y: 5, w: 20, h: 15 }, defaultParams(fx), env);
      const b = runEffect(fx.id, { width: W, height: H, data: new Uint8ClampedArray(data) }, { x: 5, y: 5, w: 20, h: 15 }, defaultParams(fx), env);
      let same = a.data.every((v, i) => v === b.data[i]);
      // pixels outside the render rect must be untouched
      let outsideOk = true;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (x >= 5 && x < 25 && y >= 5 && y < 20) continue;
        const i = (y * W + x) * 4;
        for (let k = 0; k < 4; k++) if (a.data[i + k] !== data[i + k]) outsideOk = false;
      }
      if (!same || !outsideOk) out.push(`${fx.id}: deterministic=${same} outsideUntouched=${outsideOk}`);
    }
    return out;
  });
  expect(res).toEqual([]);
});

test('curves and levels editors respond to interaction', async ({ app, page }) => {
  await paintSample(app);
  await app.run('fx.curves');
  const cv = page.locator('.curves-canvas');
  const b = await cv.boundingBox();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await app.okDialog();
  await expect.poll(() => app.hist()).toContain('Curves');
  // brightening curve: a mid-gray pixel must become lighter
  const p = await app.px(400, 400);
  expect(p[0]).toBe(255);
  await app.run('fx.levels');
  await page.locator('.levels-editor button:has-text("Auto")').click();
  await page.waitForTimeout(300);
  await app.okDialog();
  await expect.poll(() => app.hist()).toContain('Levels');
});
