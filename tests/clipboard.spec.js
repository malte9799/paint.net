import { test, expect, paintSample } from './fixtures.js';

// The (headless) system clipboard is shared between parallel workers, so keep these serial.
test.describe.configure({ mode: 'serial' });

for (const perms of [true, false]) {
  test.describe(perms ? 'with clipboard permission' : 'without clipboard permission', () => {
    if (perms) test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test('copy + paste in place, then move the pasted pixels', async ({ app, page }) => {
      await paintSample(app);
      await app.selectRect(20, 20, 120, 80);
      await page.locator('canvas.display').focus();
      await page.keyboard.press('Control+c');
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+v');
      await expect.poll(() => app.hist()).toContain('Paste');
      expect(await app.eval(() => pdn.activeTool.id)).toBe('moveselected');
      expect(await app.eval(() => pdn.activeDoc.selection.bounds)).toEqual({ x: 20, y: 20, w: 120, h: 80 });
      await app.drag([[60, 50], [460, 350]]);
      expect(await app.px(450, 350)).toEqual([224, 48, 48, 255]);
      expect(await app.px(60, 50)).toEqual([224, 48, 48, 255]); // original stays (it was a copy)
    });

    test('cut removes pixels; paste into new layer and new image', async ({ app, page }) => {
      await paintSample(app);
      await app.selectRect(20, 20, 120, 80);
      await page.locator('canvas.display').focus();
      await page.keyboard.press('Control+x');
      await page.waitForTimeout(300);
      expect((await app.px(60, 50))[3]).toBe(0);
      await page.keyboard.press('Control+Shift+v');
      await expect.poll(() => app.eval(() => pdn.activeDoc.layers.length)).toBe(2);
      await expect.poll(() => app.px(60, 50, 1)).toEqual([224, 48, 48, 255]);
      await page.keyboard.press('Control+Alt+v');
      await expect.poll(() => app.eval(() => pdn.documents.length)).toBe(2);
      expect(await app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height])).toEqual([120, 80]);
    });
  });
}

test('pasting an image larger than the canvas offers to expand it', async ({ app, page }) => {
  await app.newDoc(50, 40, '#ffffff');
  await app.eval(() => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    c.getContext('2d').fillStyle = '#123456'; c.getContext('2d').fillRect(0, 0, 200, 100);
    pdn.pasteCanvas(c, null);
  });
  await expect(page.locator('.dialog')).toContainText('larger than the canvas');
  await page.locator('.dialog .btn:has-text("Expand canvas")').click();
  await expect.poll(() => app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height])).toEqual([200, 100]);
  await expect.poll(() => app.px(150, 80)).toEqual([18, 52, 86, 255]);
  // keep canvas size
  await app.newDoc(50, 40, '#ffffff');
  await app.eval(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; pdn.pasteCanvas(c, null); });
  await page.locator('.dialog .btn:has-text("Keep canvas size")').click();
  await page.waitForTimeout(200);
  expect(await app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height])).toEqual([50, 40]);
});

test('Ctrl+V works while a checkbox or slider has focus, not while typing in a text field', async ({ app, page }) => {
  await paintSample(app);
  await app.selectRect(20, 20, 120, 80);
  await page.locator('canvas.display').focus();
  await page.keyboard.press('Control+c');
  await page.locator('.sb-zoom-slider').focus();
  await page.keyboard.press('Control+v');
  await expect.poll(() => app.hist()).toContain('Paste');
  // typing into the brush width box must not trigger tool shortcuts
  await app.tool('paintbrush');
  await page.locator('.combo-input').first().click();
  await page.keyboard.type('bp');
  expect(await app.eval(() => pdn.activeTool.id)).toBe('paintbrush');
});

test.describe('empty clipboard', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
  test('pasting with an empty clipboard explains why nothing happened', async ({ app, page }) => {
  await page.locator('canvas.display').focus();
  await app.eval(() => navigator.clipboard.writeText('not an image'));
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await page.locator('.statusbar').textContent()) + (await page.locator('.dialog').count() ? await page.locator('.dialog').textContent() : ''), { timeout: 5000 })
    .toContain('does not contain an image');
});
});
