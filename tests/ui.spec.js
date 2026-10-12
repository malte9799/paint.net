import { test, expect, paintSample } from './fixtures.js';

test('color dialog: hex, sliders, opacity; OK applies and Cancel discards', async ({ app, page }) => {
  await page.click('.swatch.primary');
  await page.locator('.hex-input').fill('3366CC80');
  await page.locator('.hex-input').press('Enter'); // Enter = OK, and must apply the typed value
  expect(await app.eval(() => pdn.primary)).toEqual({ r: 51, g: 102, b: 204, a: 128 });
  await page.click('.swatch.primary');
  const nums = page.locator('.color-dialog input.num');
  await nums.nth(0).fill('255'); await nums.nth(0).press('Tab');
  await app.cancelDialog();
  expect(await app.eval(() => pdn.primary)).toEqual({ r: 51, g: 102, b: 204, a: 128 });
  // edit secondary from within the dialog, via the hue slider track
  await app.secondary({ r: 255, g: 0, b: 0, a: 255 });
  await page.click('.swatch.primary');
  await page.locator('.seg-btn:has-text("Secondary")').click();
  const track = page.locator('.gs-track').nth(3);
  const b = await track.boundingBox();
  await page.mouse.click(b.x + b.width / 3, b.y + b.height / 2);
  await app.okDialog();
  const sec = await app.eval(() => pdn.secondary);
  expect(sec.g).toBeGreaterThan(sec.r); // ~120° hue = green
});

test('color wheel drag picks hue/saturation', async ({ app, page }) => {
  await page.click('.swatch.primary');
  const w = await page.locator('.color-wheel').boundingBox();
  await page.mouse.click(w.x + w.width - 4, w.y + w.height / 2); // 0° = red at full saturation
  await app.okDialog();
  const c = await app.eval(() => pdn.primary);
  expect(c.r).toBeGreaterThan(200);
  expect(c.g).toBeLessThan(40);
});

test('palette: left/right click and shift-click storing, persisted', async ({ app, page }) => {
  const sw = page.locator('.pal-swatch');
  await sw.nth(2).click();
  expect(await app.eval(() => pdn.primary)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  await sw.nth(10).click({ button: 'right' });
  expect(await app.eval(() => pdn.secondary)).toEqual(await app.eval(() => ({ ...pdn.palette[10] })));
  await app.primary({ r: 1, g: 2, b: 3, a: 255 });
  await sw.nth(0).click({ modifiers: ['Shift'] });
  expect(await app.eval(() => pdn.palette[0])).toEqual({ r: 1, g: 2, b: 3, a: 255 });
  await page.waitForTimeout(400);
  await page.reload(); await app.open();
  expect(await app.eval(() => pdn.palette[0])).toEqual({ r: 1, g: 2, b: 3, a: 255 });
  await app.run('edit.resetpalette');
  await app.okDialog();
  expect(await app.eval(() => pdn.palette[0])).toEqual({ r: 0, g: 0, b: 0, a: 255 });
});

test('history window: clicking items and first/last buttons', async ({ app, page }) => {
  await app.tool('pencil');
  for (let i = 0; i < 4; i++) await app.drag([[10, 10 + i * 10], [100, 10 + i * 10]]);
  await page.locator('.history-item').nth(1).click();
  expect(await app.histIndex()).toBe(1);
  await expect(page.locator('.history-item.redo')).toHaveCount(3);
  await page.locator('#win-history .fw-btn').nth(3).click();
  expect(await app.histIndex()).toBe(4);
  await page.locator('#win-history .fw-btn').nth(0).click();
  expect(await app.histIndex()).toBe(0);
  // a new action discards the redo branch
  await app.drag([[10, 200], [100, 200]]);
  expect(await app.hist()).toEqual(['New Image', 'Pencil']);
});

test('image tabs: switch, close button, middle click, dirty marker and title', async ({ app, page }) => {
  await app.newDoc(100, 100, '#fff');
  await app.newDoc(100, 100, '#000');
  await expect(page.locator('.image-tab')).toHaveCount(3);
  await page.locator('.image-tab').nth(0).click();
  expect(await app.eval(() => pdn.documents.indexOf(pdn.activeDoc))).toBe(0);
  await app.tool('pencil'); await app.drag([[5, 5], [50, 5]]);
  await expect(page.locator('.image-tab').nth(0)).toHaveClass(/dirty/);
  expect(await page.title()).toMatch(/\*/);
  await page.locator('.image-tab').nth(2).click({ button: 'middle' });
  await expect(page.locator('.image-tab')).toHaveCount(2);
  await page.locator('.image-tab').nth(1).hover();
  await page.locator('.image-tab').nth(1).locator('.tab-close').click();
  await expect(page.locator('.image-tab')).toHaveCount(1);
});

test('effect dialog controls: angle dial, pan pad, checkbox, choice, reseed', async ({ app, page }) => {
  await paintSample(app);
  await app.run('fx.motionblur');
  const dial = await page.locator('.angle-dial').boundingBox();
  await page.mouse.click(dial.x + dial.width / 2, dial.y + 2); // straight up = 90°
  expect(await page.locator('.dialog input.num').first().inputValue()).toBe('90.00');
  await page.locator('.dialog label.check input').uncheck();
  await app.okDialog();
  await app.run('fx.zoomblur');
  const pad = await page.locator('.pan-pad').boundingBox();
  await page.mouse.click(pad.x + pad.width * 0.75, pad.y + pad.height * 0.25);
  const vals = await page.locator('.pan-nums input.num').evaluateAll((els) => els.map((e) => +e.value));
  expect(vals[0]).toBeCloseTo(0.5, 1);
  expect(vals[1]).toBeCloseTo(-0.5, 1);
  await app.okDialog();
  await app.run('fx.clouds');
  await page.locator('.dialog select').selectOption('multiply');
  await page.locator('.dialog .btn:has-text("Reseed")').click();
  await page.waitForTimeout(300);
  await app.okDialog();
  await expect.poll(() => app.hist()).toEqual(['New Image', 'Motion Blur', 'Zoom Blur', 'Clouds']);
});

test('text tool: caret placement by click, move handle, recolor while editing', async ({ app, page }) => {
  await app.tool('text'); await app.setting('fontSize', 40);
  await app.click(100, 100);
  await page.keyboard.type('ABCD');
  await app.click(101, 115); // click inside the text near the start
  await page.keyboard.type('x');
  expect(await app.eval(() => pdn.tools.get('text').ta.value)).toBe('xABCD');
  await app.primary({ r: 0, g: 0, b: 255, a: 255 });
  const hp = await app.eval(() => { const t = pdn.tools.get('text'); return t.handlePos(t.layout()); });
  await app.drag([[hp.x, hp.y], [hp.x + 200, hp.y + 200]]);
  await page.keyboard.press('Escape');
  const blue = await app.eval(() => { const d = pdn.activeDoc.layers[0].ctx.getImageData(250, 250, 300, 150).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 200 && d[i] < 80) n++; return n; });
  expect(blue).toBeGreaterThan(100);
  const old = await app.eval(() => { const d = pdn.activeDoc.layers[0].ctx.getImageData(90, 90, 150, 60).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) n++; return n; });
  expect(old).toBe(0);
});

test('print renders the flattened image', async ({ app, page }) => {
  await page.evaluate(() => { window.print = () => { window.__printed = document.querySelector('#print-holder img')?.src; }; });
  await paintSample(app);
  await app.runAndWait('file.print');
  expect(await app.eval(() => window.__printed)).toMatch(/^blob:/);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('drawing with a finger paints', async ({ app, page }) => {
    await app.tool('paintbrush'); await app.setting('brushWidth', 10);
    await app.primary({ r: 0, g: 0, b: 0, a: 255 });
    const a = await app.toClient(100, 100), b = await app.toClient(300, 100);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 10, y: a.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    expect(await app.px(200, 100)).toEqual([0, 0, 0, 255]);
    expect(await app.hist()).toEqual(['New Image', 'Paintbrush']);
  });
});
