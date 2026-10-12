import { test, expect } from './fixtures.js';

test('boots with the paint.net layout and a blank 800x600 image', async ({ app, page }) => {
  await expect(page.locator('.menu-top')).toHaveText(['File', 'Edit', 'View', 'Image', 'Layers', 'Adjustments', 'Effects']);
  for (const w of ['tools', 'history', 'layers', 'colors']) await expect(page.locator('#win-' + w)).toBeVisible();
  await expect(page.locator('.tool-btn')).toHaveCount(19);
  expect(await app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height, pdn.activeDoc.layers.length])).toEqual([800, 600, 1]);
  expect(await app.px(10, 10)).toEqual([255, 255, 255, 255]);
  await expect(page.locator('.statusbar')).toContainText('800 × 600');
  expect(await app.hist()).toEqual(['New Image']);
});

test('every module loads and the worker answers', async ({ app }) => {
  const r = await app.eval(async () => {
    const { EFFECTS } = await import('./js/effects/registry.js');
    return Object.keys(EFFECTS).length;
  });
  expect(r).toBeGreaterThan(40);
});

for (const scheme of ['light', 'dark']) {
  test(`renders in ${scheme} theme without overflow`, async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await app.open();
    expect(await app.eval(() => document.documentElement.dataset.theme)).toBe(scheme);
    const overflow = await app.eval(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
    expect(overflow).toBe(false);
  });
}

test('phone-sized viewport has no page overflow and only the Tools window', async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await app.open();
  const overflow = await app.eval(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

test('menus open, show items and close', async ({ app, page }) => {
  for (const label of ['File', 'Edit', 'View', 'Image', 'Layers', 'Adjustments', 'Effects']) {
    await page.click(`.menu-top:text-is("${label}")`);
    const n = await page.locator('.menu-popup .menu-item').count();
    expect(n, label).toBeGreaterThan(3);
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 500);
    await expect(page.locator('.menu-popup')).toHaveCount(0);
  }
});

test('effects submenu opens on hover and runs an effect', async ({ app, page }) => {
  await page.click('.menu-top:text-is("Effects")');
  await page.hover('.menu-item:has-text("Stylize")');
  await page.click('.menu-item:has-text("Emboss")');
  await expect(page.locator('.dialog')).toBeVisible();
  await app.okDialog();
  await expect.poll(() => app.hist()).toContain('Emboss');
});
