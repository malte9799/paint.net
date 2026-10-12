import { test, expect, paintSample } from './fixtures.js';

test('every tool works on a 1x1 image', async ({ app, page }) => {
  await app.newDoc(1, 1, '#ffffff');
  for (const tool of await app.eval(() => [...pdn.tools.keys()])) {
    await app.tool(tool);
    await app.drag([[0.2, 0.2], [0.8, 0.8], [5, 5]]);
    await page.keyboard.press('Enter');
  }
  await app.eval(() => pdn.commitTool());
  expect(await app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height])).toEqual([1, 1]);
});

test('tools ignore clicks far outside the image without errors', async ({ app, page }) => {
  for (const tool of await app.eval(() => [...pdn.tools.keys()])) {
    if (tool === 'zoom' || tool === 'pan') continue;
    await app.tool(tool);
    await app.drag([[-50, -50], [-30, -40]]);
    await page.keyboard.press('Escape');
  }
});

test('large image: a brush stroke stays fast', async ({ app }) => {
  await app.newDoc(4000, 3000, '#ffffff');
  await app.tool('paintbrush'); await app.setting('brushWidth', 50);
  const t0 = Date.now();
  await app.drag([[100, 100], [3000, 2000], [500, 2500]], { steps: 15 });
  const dt = Date.now() - t0;
  expect(dt).toBeLessThan(15000);
  expect(await app.hist()).toEqual(['New Image', 'Paintbrush']);
});

test('new image dialog creates the requested size and background', async ({ app, page }) => {
  await app.run('file.new');
  const nums = page.locator('.dialog input.num');
  await page.locator('.dialog label.check input').first().uncheck(); // aspect ratio
  await nums.nth(0).fill('321'); await nums.nth(0).press('Tab');
  await nums.nth(1).fill('123'); await nums.nth(1).press('Tab');
  await page.locator('.dialog input[type=radio][value=transparent]').check();
  await app.okDialog();
  expect(await app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height])).toEqual([321, 123]);
  expect((await app.px(10, 10))[3]).toBe(0);
});

test('resize by percentage and with aspect lock', async ({ app, page }) => {
  await paintSample(app);
  await app.run('image.resize');
  await page.locator('.dialog input[type=radio][value=pct]').check();
  await page.locator('.dialog input.num').nth(0).fill('50');
  await page.locator('.dialog input.num').nth(0).press('Tab');
  await app.okDialog();
  expect(await app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height])).toEqual([400, 300]);
  await app.run('image.resize');
  await page.locator('.dialog input.num').nth(1).fill('200'); // width, aspect locked
  await page.locator('.dialog input.num').nth(1).press('Tab');
  await app.okDialog();
  expect(await app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height])).toEqual([200, 150]);
});

test('canvas size anchors place the old image correctly', async ({ app, page }) => {
  await app.newDoc(10, 10, '#ff0000');
  for (const [cell, x, y] of [[0, 0, 0], [4, 5, 5], [8, 10, 10]]) {
    await app.run('image.canvassize');
    await page.locator('.dialog label.check input').first().uncheck();
    const nums = page.locator('.dialog input.num');
    await nums.nth(1).fill('20'); await nums.nth(1).press('Tab');
    await nums.nth(2).fill('20'); await nums.nth(2).press('Tab');
    await page.locator('.anchor-cell').nth(cell).click();
    await app.okDialog();
    expect(await app.px(x + 5, y + 5)).toEqual([255, 0, 0, 255]);
    await app.eval(() => pdn.activeDoc.history.undo());
  }
});

test('dialogs block canvas input and close with Escape', async ({ app, page }) => {
  await app.run('image.resize');
  const before = await app.sig();
  const c = await app.toClient(100, 100);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Escape');
  expect(await app.sig()).toBe(before);
  expect(await app.dialogOpen()).toBe(false);
});

test('rapid undo/redo spam and tool switching while dragging', async ({ app, page }) => {
  await paintSample(app);
  await app.tool('paintbrush');
  for (let i = 0; i < 10; i++) await app.drag([[10 + i * 30, 10], [40 + i * 30, 200]], { steps: 2 });
  await page.locator('canvas.display').focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press(i % 3 ? 'Control+z' : 'Control+y');
  // switch tools mid-drag
  const p = await app.toClient(300, 300);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 50, p.y + 50);
  await page.keyboard.press('s');
  await page.mouse.move(p.x + 80, p.y + 20);
  await page.mouse.up();
  await app.eval(() => pdn.activeDoc.history.goto(0));
  await app.eval(() => pdn.activeDoc.history.goto(1e9));
});

test('window resize keeps floating windows on screen', async ({ app, page }) => {
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(300);
  for (const w of ['tools', 'history', 'layers', 'colors']) {
    const b = await page.locator('#win-' + w).boundingBox();
    if (!b) continue;
    expect(b.x, w).toBeLessThan(700 - 20);
    expect(b.y, w).toBeLessThan(500 - 10);
  }
});
