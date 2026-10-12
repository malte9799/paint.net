import { test, expect, paintSample } from './fixtures.js';

// Commands that open a dialog, how to answer it, and commands to skip in the generic sweep.
const SKIP = new Set(['file.open', 'file.print', 'file.save', 'file.saveas', 'file.saveall', 'file.recent', 'layers.import', 'app.website', 'file.close', 'file.closeall', 'edit.paste', 'edit.pastelayer', 'edit.pasteimage', 'edit.cut', 'edit.copy', 'edit.copymerged', 'window.next', 'window.prev']);

async function settle(app) {
  // Answer any dialog that a command opened with OK and wait for async work.
  for (let i = 0; i < 3; i++) {
    await app.page.waitForTimeout(120);
    if (await app.dialogOpen()) await app.okDialog();
  }
  await app.page.evaluate(() => window.__lastRun);
  await app.page.waitForTimeout(100);
}

test('every command runs without errors, with a selection and two layers', async ({ app }) => {
  test.setTimeout(240_000);
  await paintSample(app);
  const ids = await app.eval(() => [...pdn.commands.keys()]);
  for (const id of ids) {
    if (SKIP.has(id)) continue;
    await app.eval(() => {
      const d = pdn.activeDoc;
      if (d.layers.length < 2) pdn.run('layers.add');
      d.selection.setRect({ x: 30, y: 30, w: 150, h: 120 });
      d.emit('selection');
    });
    await app.run(id);
    await settle(app);
    expect(await app.dialogOpen(), `dialog left open by ${id}`).toBe(false);
  }
});

test('every command works when no image is open', async ({ app }) => {
  await app.eval(() => { pdn.activeDoc.markSaved(); });
  await app.run('file.closeall');
  await app.page.waitForTimeout(300);
  expect(await app.eval(() => pdn.documents.length)).toBe(0);
  const ids = await app.eval(() => [...pdn.commands.keys()]);
  for (const id of ids) {
    if (SKIP.has(id) || id.startsWith('app.') || id === 'file.new' || id === 'edit.resetpalette') continue;
    await app.run(id);
    await settle(app);
  }
  // keyboard shortcuts with no document
  for (const k of ['Control+z', 'Control+a', 'Delete', 'Backspace', 'x', 'b', 'Control+Shift+n', 'Control+b']) await app.page.keyboard.press(k);
  expect(await app.eval(() => pdn.documents.length)).toBe(0);
});

// Each undoable command: run, then undo must restore the exact previous state and redo the result.
const UNDOABLE = [
  'edit.selectall', 'edit.invertsel', 'edit.erase', 'edit.fill', 'edit.deselect',
  'image.crop', 'image.fliph', 'image.flipv', 'image.rotcw', 'image.rotccw', 'image.rot180', 'image.flatten',
  'layers.add', 'layers.duplicate', 'layers.merge', 'layers.delete', 'layers.fliph', 'layers.flipv', 'layers.up', 'layers.down',
  'fx.invert', 'fx.sepia', 'fx.blackwhite', 'fx.autolevel', 'fx.gaussianblur', 'fx.huesaturation',
];
for (const id of UNDOABLE) {
  test(`undo/redo restores state exactly: ${id}`, async ({ app }) => {
    await paintSample(app);
    await app.eval(() => {
      const d = pdn.activeDoc;
      const { Layer } = d.layers[0].constructor ? { Layer: d.layers[0].constructor } : {};
      const l = new Layer(d.width, d.height, 'Top');
      l.ctx.fillStyle = 'rgba(255,200,0,0.7)'; l.ctx.fillRect(150, 100, 300, 200);
      d.layers.push(l); d.activeIndex = 1;
      d.selection.setRect({ x: 40, y: 50, w: 200, h: 150 });
      d.invalidate(); d.emit('layers'); d.emit('selection');
    });
    if (id === 'layers.up') await app.eval(() => pdn.activeDoc.setActiveLayer(0));
    const before = await app.sig();
    await app.run(id);
    await settle(app);
    const after = await app.sig();
    const hist = await app.hist();
    expect(hist.length, `${id} should add a history item`).toBe(2);
    if (id !== 'fx.huesaturation') expect(after).not.toBe(before); // its defaults are an identity transform
    await app.checkUndoRedo(before, after);
  });
}
