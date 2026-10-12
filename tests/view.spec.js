import { test, expect } from './fixtures.js';

test('toImage and toScreen are inverse at every zoom level', async ({ app }) => {
  const errs = await app.eval(async () => {
    const { ZOOM_LEVELS } = await import('./js/view.js');
    const v = pdn.view, r = v.display.getBoundingClientRect(), bad = [];
    for (const z of ZOOM_LEVELS) {
      v.setZoom(z);
      for (const [x, y] of [[0, 0], [123.5, 77.25], [799, 599]]) {
        const s = v.toScreen(x, y), p = v.toImage(s.x + r.left, s.y + r.top);
        if (Math.abs(p.x - x) > 1e-6 || Math.abs(p.y - y) > 1e-6) bad.push([z, x, y, p.x, p.y]);
      }
    }
    return bad;
  });
  expect(errs).toEqual([]);
});

test('zoom in/out stay within limits and Ctrl+wheel keeps the point under the cursor', async ({ app, page }) => {
  for (let i = 0; i < 60; i++) await app.eval(() => pdn.view.zoomIn());
  expect(await app.eval(() => pdn.view.zoom)).toBe(64);
  for (let i = 0; i < 80; i++) await app.eval(() => pdn.view.zoomOut());
  expect(await app.eval(() => pdn.view.zoom)).toBe(0.01);
  // start zoomed in enough that the image overflows the viewport in both directions
  await app.eval(() => pdn.view.setZoom(2));
  const c = await app.toClient(300, 200);
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  expect(await app.eval(() => pdn.view.zoom)).toBeGreaterThan(2);
  const p = await app.eval(([x, y]) => pdn.view.toImage(x, y), [c.x, c.y]);
  expect(Math.abs(p.x - 300)).toBeLessThan(1);
  expect(Math.abs(p.y - 200)).toBeLessThan(1);
});

test('status bar zoom box, slider and fit', async ({ app, page }) => {
  await page.locator('.sb-zoom-input').fill('250');
  await page.locator('.sb-zoom-input').press('Enter');
  expect(await app.eval(() => pdn.view.zoom)).toBe(2.5);
  await page.keyboard.press('Control+b');
  const z = await app.eval(() => pdn.view.zoom);
  const fits = await app.eval(() => pdn.activeDoc.width * pdn.view.zoom <= pdn.view.viewW && pdn.activeDoc.height * pdn.view.zoom <= pdn.view.viewH);
  expect(fits).toBe(true);
  expect(z).toBeGreaterThan(0.5);
  await page.keyboard.press('Control+0');
  expect(await app.eval(() => pdn.view.zoom)).toBe(1);
});

test('rulers, pixel grid and units update without errors', async ({ app, page }) => {
  await app.runAndWait('view.rulers');
  await app.runAndWait('view.grid');
  await app.eval(() => pdn.view.setZoom(8));
  for (const u of ['in', 'cm', 'px']) { await app.runAndWait('view.units.' + u); await page.waitForTimeout(50); }
  await expect(page.locator('.ruler-h')).toBeVisible();
  const size = await page.locator('.ruler-h').boundingBox();
  expect(size.height).toBeCloseTo(18, 0);
});

test('switching documents keeps each one\'s zoom and scroll', async ({ app }) => {
  await app.eval(() => pdn.view.setZoom(4));
  await app.eval(() => { pdn.view.scroller.scrollLeft = 300; });
  await app.newDoc(200, 100, '#fff');
  await app.eval(() => pdn.view.setZoom(2));
  await app.eval(() => pdn.setActiveDocument(pdn.documents[0]));
  expect(await app.eval(() => [pdn.view.zoom, pdn.view.scroller.scrollLeft])).toEqual([4, 300]);
  await app.eval(() => pdn.setActiveDocument(pdn.documents[1]));
  expect(await app.eval(() => pdn.view.zoom)).toBe(2);
});

test('floating windows can be dragged, closed, toggled and reset', async ({ app, page }) => {
  const title = page.locator('#win-layers .fw-title');
  const b0 = await page.locator('#win-layers').boundingBox();
  await title.hover();
  await page.mouse.down();
  await page.mouse.move(b0.x - 200, b0.y - 50, { steps: 5 });
  await page.mouse.up();
  const b1 = await page.locator('#win-layers').boundingBox();
  expect(b1.x).toBeLessThan(b0.x - 150);
  await page.keyboard.press('F7');
  await expect(page.locator('#win-layers')).toBeHidden();
  await page.keyboard.press('F7');
  await expect(page.locator('#win-layers')).toBeVisible();
  await app.runAndWait('window.reset');
  const b2 = await page.locator('#win-layers').boundingBox();
  expect(Math.abs(b2.x - b0.x)).toBeLessThan(2);
});
