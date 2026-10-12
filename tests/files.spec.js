import { test, expect, paintSample } from './fixtures.js';
import fs from 'fs';

// Force the download/<input type=file> code paths (no File System Access API).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
});

async function makeLayered(app) {
  await paintSample(app);
  await app.eval(() => {
    const d = pdn.activeDoc;
    pdn.run('layers.add');
    const l = d.layers[1];
    l.ctx.fillStyle = 'rgba(0,128,255,0.6)'; l.ctx.fillRect(300, 200, 250, 150);
    l.name = 'Ébène "quoted" <&>'; l.opacity = 180; l.blendMode = 'multiply';
    pdn.run('layers.add');
    d.layers[2].visible = false; d.layers[2].blendMode = 'reflect';
    d.layers[2].ctx.fillStyle = '#0f0'; d.layers[2].ctx.fillRect(0, 0, 50, 50);
    d.invalidate();
  });
}

async function saveAs(app, name, type, { quality } = {}) {
  const page = app.page;
  await app.run('file.saveas');
  const dlg = page.locator('.dialog');
  await dlg.locator('input.text').fill(name);
  await dlg.locator('select').selectOption(type);
  const dl = page.waitForEvent('download');
  await app.okDialog();
  // flatten prompt / quality dialog
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(250);
    if (await app.dialogOpen()) {
      if (quality != null && await page.locator('.dialog .slider').count()) {
        await page.locator('.dialog input.num').fill(String(quality));
        await page.locator('.dialog input.num').press('Tab');
      }
      await app.okDialog();
    }
  }
  const d = await dl;
  const path = test.info().outputPath(d.suggestedFilename());
  await d.saveAs(path);
  return { path, name: d.suggestedFilename() };
}

async function openFile(app, path) {
  const chooser = app.page.waitForEvent('filechooser');
  await app.run('file.open');
  await (await chooser).setFiles(path);
  await app.page.waitForTimeout(500);
}

test('OpenRaster round trip keeps layers, names, opacity, visibility and blend modes', async ({ app }) => {
  await makeLayered(app);
  const before = await app.sig();
  const { path, name } = await saveAs(app, 'layered', 'ora');
  expect(name).toBe('layered.ora');
  expect(await app.eval(() => [pdn.activeDoc.name, pdn.activeDoc.dirty])).toEqual(['layered.ora', false]);
  await openFile(app, path);
  expect(await app.eval(() => pdn.documents.length)).toBe(2);
  const after = JSON.parse(await app.sig()), b = JSON.parse(before);
  expect(after.layers).toEqual(b.layers);
});

for (const [type, ext, exact] of [['png', 'png', true], ['bmp', 'bmp', true], ['tga', 'tga', true], ['webp', 'webp', false], ['jpg', 'jpg', false]]) {
  test(`save and reopen ${type}`, async ({ app }) => {
    await makeLayered(app);
    const flatBefore = await app.eval(() => { const c = pdn.activeDoc.flatten(); return Array.from(c.getContext('2d').getImageData(0, 0, 800, 600).data); });
    const { path, name } = await saveAs(app, 'out', type, { quality: 100 });
    expect(name).toBe('out.' + ext);
    // multi-layer → flattened as part of saving, recorded in history
    expect(await app.hist()).toContain('Flatten');
    expect(fs.statSync(path).size).toBeGreaterThan(100);
    await openFile(app, path);
    const reopened = await app.eval(() => { const d = pdn.activeDoc; return { n: d.name, w: d.width, h: d.height, px: Array.from(d.layers[0].ctx.getImageData(0, 0, 800, 600).data) }; });
    expect([reopened.n, reopened.w, reopened.h]).toEqual(['out.' + ext, 800, 600]);
    let maxDiff = 0;
    for (let i = 0; i < flatBefore.length; i++) {
      // JPEG has no alpha: compare against the image over white
      if (type === 'jpg' && i % 4 === 3) continue;
      maxDiff = Math.max(maxDiff, Math.abs(flatBefore[i] - reopened.px[i]));
    }
    if (exact) expect(maxDiff).toBeLessThanOrEqual(1);
    else expect(maxDiff).toBeLessThan(type === 'jpg' ? 60 : 40);
  });
}

test('TGA decoder handles RLE, 24-bit and bottom-up images', async ({ app }) => {
  const r = await app.eval(async () => {
    const { decodeTGA } = await import('./js/formats.js');
    // 3x2 RLE true-color 24-bit, bottom-left origin: rows bottom→top
    const hdr = new Uint8Array(18); hdr[2] = 10; hdr[12] = 3; hdr[14] = 2; hdr[16] = 24; hdr[17] = 0;
    const body = [0x82, 0, 0, 255, /* 3 red */ 0x02, 0, 255, 0, 255, 0, 0, 0, 0, 255]; // raw: green, blue, red
    const buf = new Uint8Array([...hdr, ...body]).buffer;
    const c = decodeTGA(buf);
    return Array.from(c.getContext('2d').getImageData(0, 0, 3, 2).data);
  });
  // top row = second encoded row (green, blue, red); bottom row = red x3
  expect(r).toEqual([0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
});

test('BMP encoder writes 32-bit with alpha and 24-bit when opaque', async ({ app }) => {
  const r = await app.eval(async () => {
    const { encodeBMP } = await import('./js/formats.js');
    const c = document.createElement('canvas'); c.width = 5; c.height = 3;
    const x = c.getContext('2d'); x.fillStyle = 'rgba(10,20,30,0.5)'; x.fillRect(0, 0, 5, 3);
    const a = new DataView(await encodeBMP(c).arrayBuffer());
    x.fillStyle = '#123456'; x.fillRect(0, 0, 5, 3);
    const b = new DataView(await encodeBMP(c).arrayBuffer());
    return [a.getUint16(28, true), b.getUint16(28, true), b.byteLength];
  });
  expect(r).toEqual([32, 24, 54 + 16 * 3]);
});

test('ZIP writer output can be read back', async ({ app }) => {
  const r = await app.eval(async () => {
    const { zipStore, unzip } = await import('./js/formats.js');
    const enc = new TextEncoder();
    const z = zipStore([{ name: 'a.txt', data: enc.encode('hello') }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
    const u = await unzip(await z.arrayBuffer());
    return [u.names(), new TextDecoder().decode(await u.bytes('a.txt')), Array.from(await u.bytes('dir/b.bin'))];
  });
  expect(r).toEqual([['a.txt', 'dir/b.bin'], 'hello', [1, 2, 3]]);
});

test('opening a corrupt file shows an error and keeps working', async ({ app, page }) => {
  const p = test.info().outputPath('broken.png');
  fs.writeFileSync(p, 'this is not a png');
  await openFile(app, p);
  await expect(page.locator('.dialog')).toContainText('There was an error opening');
  await app.okDialog();
  const p2 = test.info().outputPath('broken.ora');
  fs.writeFileSync(p2, 'PK not a zip');
  await openFile(app, p2);
  await expect(page.locator('.dialog')).toContainText('There was an error opening');
  await app.okDialog();
  expect(await app.eval(() => pdn.documents.length)).toBe(1);
  test.info().annotations.push({ type: 'allow-errors' });
});

test('opening multiple files and the recent list', async ({ app, page }) => {
  await paintSample(app);
  const { path: a } = await saveAs(app, 'first', 'png');
  await app.newDoc(50, 40, '#ff0000');
  const { path: b } = await saveAs(app, 'second', 'png');
  const chooser = page.waitForEvent('filechooser');
  await app.run('file.open');
  await (await chooser).setFiles([a, b]);
  await page.waitForTimeout(600);
  // the two saved documents were renamed on save; the two opened copies follow them
  expect(await app.eval(() => pdn.documents.map((d) => d.name))).toEqual(['first.png', 'second.png', 'first.png', 'second.png']);
  await page.click('.menu-top:text-is("File")');
  await page.hover('.menu-item:has-text("Open Recent")');
  await expect(page.locator('.menu-popup >> nth=1')).toContainText('second.png');
  await page.locator('.menu-popup >> nth=1').locator('.menu-item:has-text("first.png")').click();
  await page.waitForTimeout(500);
  expect(await app.eval(() => pdn.documents.length)).toBe(5);
});

test('dropping an image file onto the workspace opens it', async ({ app, page }) => {
  const png = await app.eval(async () => {
    const c = document.createElement('canvas'); c.width = 30; c.height = 20;
    c.getContext('2d').fillStyle = '#00f'; c.getContext('2d').fillRect(0, 0, 30, 20);
    return c.toDataURL();
  });
  const dt = await page.evaluateHandle(async (url) => {
    const blob = await (await fetch(url)).blob();
    const d = new DataTransfer();
    d.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
    return d;
  }, png);
  await page.dispatchEvent('main.workspace', 'dragover', { dataTransfer: dt });
  await page.dispatchEvent('main.workspace', 'drop', { dataTransfer: dt });
  await expect.poll(() => app.eval(() => pdn.activeDoc.name)).toBe('dropped.png');
  expect(await app.eval(() => [pdn.activeDoc.width, pdn.activeDoc.height])).toEqual([30, 20]);
});
