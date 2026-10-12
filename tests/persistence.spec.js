import { test, expect, paintSample } from './fixtures.js';

test('open images, layers and the active image survive a reload', async ({ app, page }) => {
  await paintSample(app);
  await app.run('layers.add');
  await app.eval(() => { const l = pdn.activeDoc.layers[1]; l.name = 'Kept'; l.opacity = 77; l.blendMode = 'screen'; l.visible = false; pdn.activeDoc.emit('history'); });
  await app.newDoc(123, 45, '#00ff00');
  await app.eval(() => pdn.setActiveDocument(pdn.documents[0]));
  const sigs = await app.eval(() => pdn.documents.map((d) => d.id));
  const s0 = await app.sig();
  await page.waitForTimeout(1800); // autosave debounce
  await page.reload();
  await app.open();
  expect(await app.eval(() => pdn.documents.map((d) => d.id))).toEqual(sigs);
  expect(await app.sig()).toBe(s0);
  expect(await app.eval(() => [pdn.documents[1].width, pdn.documents[1].height])).toEqual([123, 45]);
  // restored images keep their unsaved marker
  expect(await app.eval(() => pdn.documents[0].dirty)).toBe(true);
});

test('settings persist: tool, colors, tool options, windows, theme, rulers', async ({ app, page }) => {
  await app.tool('gradient');
  await app.primary({ r: 1, g: 2, b: 3, a: 200 });
  await app.setting('brushWidth', 33);
  await page.locator('#win-history .fw-close').click();
  await app.runAndWait('view.rulers');
  await page.waitForTimeout(400);
  await page.reload();
  await app.open();
  expect(await app.eval(() => [pdn.activeTool.id, pdn.primary, pdn.toolSettings.brushWidth, pdn.windows.history.visible, pdn.view.rulers]))
    .toEqual(['gradient', { r: 1, g: 2, b: 3, a: 200 }, 33, false, true]);
});

test('closed images are not restored; an empty session starts a new image', async ({ app, page }) => {
  await app.eval(() => pdn.activeDoc.markSaved());
  await app.runAndWait('file.close');
  await page.waitForTimeout(400);
  await page.reload();
  await app.open();
  expect(await app.eval(() => pdn.documents.length)).toBe(1);
  expect(await app.eval(() => pdn.activeDoc.history.items.length)).toBe(1);
});

test('closing an unsaved image asks; Cancel keeps it, Don\'t Save closes it', async ({ app, page }) => {
  await paintSample(app);
  await app.run('layers.add');
  await app.run('file.close');
  await expect(page.locator('.dialog')).toContainText('Save changes');
  await page.locator('.dialog .btn:text-is("Cancel")').click();
  expect(await app.eval(() => pdn.documents.length)).toBe(1);
  await app.run('file.close');
  await page.locator('.dialog .btn:text-is("Don\'t Save")').click();
  await expect.poll(() => app.eval(() => pdn.documents.length)).toBe(0);
  await expect(page.locator('.empty-msg')).toBeVisible();
});

test('turning autosave off stops restoring images', async ({ app, page }) => {
  await app.eval(async () => { const { Settings } = await import('./js/storage.js'); Settings.set('autosave', false); Settings._save.flush(); });
  await app.newDoc(77, 77, '#000');
  await page.waitForTimeout(500);
  await page.reload();
  await app.open();
  expect(await app.eval(() => pdn.documents.map((d) => d.width))).toEqual([800]);
});

test('settings dialog: clear stored data and reset settings', async ({ app, page }) => {
  await app.setting('brushWidth', 50);
  await app.run('app.settings');
  await page.locator('.dialog .btn:has-text("Clear stored images")').click();
  await page.locator('.dialog .btn:has-text("Reset all settings")').click();
  await app.okDialog();
  expect(await app.eval(() => pdn.toolSettings.brushWidth)).toBe(2);
  const n = await app.eval(async () => { const { idb } = await import('./js/storage.js'); return (await idb.getAll('recent')).length; });
  expect(n).toBe(0);
});
