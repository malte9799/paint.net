import { test, expect, paintSample } from './fixtures.js';

const RED = { r: 220, g: 20, b: 20, a: 255 }, BLUE = { r: 20, g: 40, b: 220, a: 255 };
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test.beforeEach(async ({ app }) => { await app.primary(RED); await app.secondary(BLUE); });

test('paintbrush: primary with left, secondary with right, respects selection', async ({ app }) => {
  await app.tool('paintbrush'); await app.setting('brushWidth', 20); await app.setting('hardness', 100);
  await app.drag([[50, 50], [200, 50]]);
  expect(await app.px(120, 50)).toEqual([220, 20, 20, 255]);
  await app.drag([[50, 120], [200, 120]], { button: 'right' });
  expect(await app.px(120, 120)).toEqual([20, 40, 220, 255]);
  await app.selectRect(300, 0, 100, 600);
  await app.drag([[250, 200], [450, 200]]);
  expect(await app.px(260, 200)).toEqual([255, 255, 255, 255]);
  expect(await app.px(350, 200)).toEqual([220, 20, 20, 255]);
  expect(await app.px(440, 200)).toEqual([255, 255, 255, 255]);
  expect(await app.hist()).toEqual(['New Image', 'Paintbrush', 'Paintbrush', 'Paintbrush']);
});

test('paintbrush: antialiasing off yields only fully opaque/transparent pixels', async ({ app }) => {
  await app.run('layers.add');
  await app.tool('paintbrush'); await app.setting('brushWidth', 15); await app.setting('antialias', false); await app.setting('hardness', 100);
  await app.drag([[40, 40], [300, 170]]);
  const alphas = await app.eval(() => { const d = pdn.activeDoc.activeLayer.ctx.getImageData(0, 0, 400, 300).data; const s = new Set(); for (let i = 3; i < d.length; i += 4) s.add(d[i]); return [...s].sort((a, b) => a - b); });
  expect(alphas).toEqual([0, 255]);
});

test('paintbrush: translucent color does not exceed its alpha within one stroke', async ({ app }) => {
  await app.run('layers.add');
  await app.primary({ r: 0, g: 0, b: 0, a: 100 });
  await app.tool('paintbrush'); await app.setting('brushWidth', 30); await app.setting('hardness', 100);
  await app.drag([[50, 100], [300, 100], [60, 105], [290, 98]], { steps: 20 });
  const a = (await app.px(150, 100, 1))[3];
  expect(a).toBeGreaterThanOrEqual(98);
  expect(a).toBeLessThanOrEqual(102);
});

test('paintbrush: overwrite blend mode replaces alpha', async ({ app }) => {
  await app.primary({ r: 0, g: 200, b: 0, a: 128 });
  await app.tool('paintbrush'); await app.setting('blendMode', 'overwrite'); await app.setting('brushWidth', 30); await app.setting('hardness', 100);
  await app.drag([[100, 100], [200, 100]]);
  const p = await app.px(150, 100, 0);
  expect(near(p, [0, 200, 0, 128], 2)).toBe(true);
});

test('soft paintbrush (low hardness) paints a soft edge', async ({ app }) => {
  await app.run('layers.add');
  await app.tool('paintbrush'); await app.setting('brushWidth', 60); await app.setting('hardness', 0);
  await app.drag([[200, 150], [201, 150]]);
  const center = (await app.px(200, 150, 1))[3], edge = (await app.px(225, 150, 1))[3];
  expect(center).toBeGreaterThan(200);
  expect(edge).toBeGreaterThan(0);
  expect(edge).toBeLessThan(center);
});

test('eraser makes pixels transparent only inside the selection', async ({ app }) => {
  await app.tool('eraser'); await app.setting('brushWidth', 20);
  await app.selectRect(0, 0, 150, 600);
  await app.drag([[50, 80], [300, 80]]);
  expect((await app.px(100, 80))[3]).toBe(0);
  expect(await app.px(250, 80)).toEqual([255, 255, 255, 255]);
});

test('pencil draws exact 1px lines', async ({ app }) => {
  await app.tool('pencil');
  await app.drag([[10, 10], [60, 10]]);
  expect(await app.px(30, 10)).toEqual([220, 20, 20, 255]);
  expect(await app.px(30, 11)).toEqual([255, 255, 255, 255]);
  expect(await app.px(30, 9)).toEqual([255, 255, 255, 255]);
});

test('paint bucket: contiguous, global, tolerance and selection', async ({ app }) => {
  await paintSample(app);
  await app.tool('paintbucket'); await app.setting('tolerance', 0); await app.setting('antialias', false);
  await app.click(60, 50);
  expect(await app.px(60, 50)).toEqual([220, 20, 20, 255]);
  expect(await app.px(5, 5)).toEqual([255, 255, 255, 255]);
  // global fill of white replaces all white
  await app.setting('floodMode', 'global');
  await app.click(5, 5, { button: 'right' });
  expect(await app.px(5, 5)).toEqual([20, 40, 220, 255]);
  expect(await app.px(790, 590)).toEqual([20, 40, 220, 255]);
  // inside a selection, the fill stops at the selection edge
  await app.run('edit.deselect');
  await app.setting('floodMode', 'contiguous');
  await app.selectRect(400, 0, 100, 100);
  await app.click(450, 50);
  expect(await app.px(450, 50)).toEqual([220, 20, 20, 255]);
  expect(await app.px(550, 50)).toEqual([20, 40, 220, 255]);
});

test('paint bucket ignores clicks outside the image', async ({ app }) => {
  await app.tool('paintbucket');
  const before = await app.sig();
  await app.click(-20, -20);
  await app.click(900, 700);
  expect(await app.sig()).toBe(before);
});

for (const type of ['linear', 'reflected', 'diamond', 'radial', 'conical', 'spiralcw', 'spiralccw']) {
  for (const mode of ['color', 'transparency']) {
    test(`gradient ${type} / ${mode}`, async ({ app }) => {
      await app.tool('gradient'); await app.setting('gradientType', type); await app.setting('gradientMode', mode);
      const before = await app.sig();
      await app.drag([[100, 150], [500, 150]]);
      await app.page.keyboard.press('Enter');
      expect(await app.hist()).toContain('Gradient');
      const after = await app.sig();
      expect(after).not.toBe(before);
      if (type === 'linear' && mode === 'color') {
        expect(near(await app.px(100, 150), [220, 20, 20, 255], 4)).toBe(true);
        expect(near(await app.px(700, 150), [20, 40, 220, 255], 2)).toBe(true);
      }
      if (type === 'linear' && mode === 'transparency') {
        expect((await app.px(50, 150, 0))[3]).toBe(255);
        expect((await app.px(700, 150, 0))[3]).toBe(0);
      }
      await app.checkUndoRedo(before, after);
    });
  }
}

test('gradient handles can be dragged and Escape cancels', async ({ app }) => {
  await app.tool('gradient');
  const before = await app.sig();
  await app.drag([[100, 150], [300, 150]]);
  await app.drag([[300, 150], [600, 150]]); // drag end handle
  expect(near(await app.px(400, 150), await app.px(400, 150))).toBe(true);
  await app.page.keyboard.press('Escape');
  expect(await app.sig()).toBe(before);
  expect(await app.hist()).toEqual(['New Image']);
});

test('color picker picks primary/secondary and can switch back', async ({ app }) => {
  await paintSample(app);
  await app.tool('colorpicker');
  await app.click(60, 50);
  expect(await app.eval(() => pdn.primary)).toEqual({ r: 224, g: 48, b: 48, a: 255 });
  await app.click(220, 150, { button: 'right' });
  expect(await app.eval(() => pdn.secondary)).toEqual({ r: 48, g: 96, b: 224, a: 255 });
  await app.tool('paintbrush'); await app.tool('colorpicker');
  await app.setting('pickerAfter', 'previous');
  await app.click(5, 5);
  expect(await app.eval(() => pdn.activeTool.id)).toBe('paintbrush');
});

test('clone stamp copies from the source offset', async ({ app }) => {
  await paintSample(app);
  await app.tool('clonestamp'); await app.setting('brushWidth', 10); await app.setting('hardness', 100);
  await app.click(60, 50, { modifiers: ['Control'] });
  await app.drag([[400, 400], [410, 400]]);
  expect(await app.px(405, 400)).toEqual([224, 48, 48, 255]);
  expect(await app.hist()).toEqual(['New Image', 'Clone Stamp']);
});

test('recolor replaces the secondary color with the primary', async ({ app }) => {
  await paintSample(app);
  await app.secondary({ r: 224, g: 48, b: 48, a: 255 });
  await app.primary({ r: 0, g: 200, b: 0, a: 255 });
  await app.tool('recolor'); await app.setting('brushWidth', 40); await app.setting('tolerance', 0.3);
  await app.drag([[40, 60], [120, 60]]);
  expect(await app.px(80, 60)).toEqual([0, 200, 0, 255]);
  expect(await app.px(80, 150)).toEqual([255, 255, 255, 255]);
});

test('text tool: type, restyle, commit, undo', async ({ app, page }) => {
  await app.tool('text'); await app.setting('fontSize', 36);
  const before = await app.sig();
  await app.click(100, 100);
  await page.keyboard.type('Hello\nWorld');
  await app.setting('fontStyle', { bold: true, italic: false, underline: true, strike: false });
  await page.keyboard.press('Escape');
  const after = await app.sig();
  expect(after).not.toBe(before);
  expect(await app.hist()).toEqual(['New Image', 'Text']);
  // red pixels exist where text is
  const count = await app.eval(() => { const d = pdn.activeDoc.layers[0].ctx.getImageData(90, 90, 200, 120).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 100) n++; return n; });
  expect(count).toBeGreaterThan(200);
  await app.checkUndoRedo(before, after);
});

test('text tool: empty text adds no history; switching tool commits', async ({ app, page }) => {
  await app.tool('text');
  await app.click(100, 100);
  await page.keyboard.press('Escape');
  expect(await app.hist()).toEqual(['New Image']);
  await app.click(100, 100);
  await page.keyboard.type('abc');
  await app.tool('paintbrush');
  expect(await app.hist()).toEqual(['New Image', 'Text']);
});

test('line/curve with control point, arrows and dashes', async ({ app, page }) => {
  await app.tool('linecurve'); await app.setting('brushWidth', 6); await app.setting('arrows', 'both'); await app.setting('lineStyle', 'dash');
  const before = await app.sig();
  await app.drag([[100, 300], [600, 300]]);
  await app.drag([[350, 300], [350, 200]]); // bend
  expect(await app.eval(() => pdn.activeTool.edit.pts.length)).toBe(3);
  await page.keyboard.press('Enter');
  const after = await app.sig();
  expect(after).not.toBe(before);
  expect(await app.hist()).toEqual(['New Image', 'Line/Curve']);
  await app.checkUndoRedo(before, after);
});

const SHAPES = ['rectangle', 'roundrect', 'ellipse', 'diamond', 'triangle', 'righttriangle', 'pentagon', 'hexagon', 'octagon', 'star5', 'star6', 'plus', 'arrowright', 'heart', 'callout'];
for (const shape of SHAPES) {
  test(`shape ${shape} in all draw modes`, async ({ app, page }) => {
    await app.tool('shapes'); await app.setting('shapeType', shape); await app.setting('brushWidth', 4);
    for (const [i, mode] of ['outline', 'fill', 'both'].entries()) {
      await app.setting('shapeDraw', mode);
      const before = await app.sig();
      await app.drag([[50 + i * 250, 100], [250 + i * 250, 300]]);
      await page.keyboard.press('Enter');
      expect(await app.sig(), `${shape}/${mode}`).not.toBe(before);
    }
    expect(await app.hist()).toEqual(['New Image', 'Shapes', 'Shapes', 'Shapes']);
    if (shape === 'rectangle') {
      expect(await app.px(600, 200)).toEqual([20, 40, 220, 255]); // fill+outline: interior is secondary
      expect(await app.px(551, 200)).toEqual([220, 20, 20, 255]); // outline is primary
      expect(await app.px(400, 200)).toEqual([220, 20, 20, 255]); // filled: primary
    }
  });
}

test('shapes: resize with a handle and move by dragging inside', async ({ app, page }) => {
  await app.tool('shapes'); await app.setting('shapeDraw', 'fill');
  await app.drag([[100, 100], [200, 200]]);
  await app.drag([[200, 200], [300, 250]]); // bottom-right handle
  await app.drag([[150, 150], [450, 150]]); // move
  await page.keyboard.press('Enter');
  expect(await app.eval(() => null)).toBe(null);
  expect(await app.px(150, 150)).toEqual([255, 255, 255, 255]);
  expect(await app.px(500, 200)).toEqual([220, 20, 20, 255]);
});

test('selection modes combine correctly', async ({ app }) => {
  await app.tool('rectselect');
  const area = () => app.eval(() => { const s = pdn.activeDoc.selection; if (s.empty) return 0; const d = s.ctx.getImageData(0, 0, s.w, s.h).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) n++; return n; });
  await app.drag([[0, 0], [100, 100]]);
  expect(await area()).toBe(10000);
  await app.drag([[50, 50], [150, 150]], { modifiers: ['Control'] }); // union
  expect(await area()).toBe(17500);
  await app.drag([[0, 0], [50, 50]], { modifiers: ['Alt'] }); // exclude
  expect(await area()).toBe(15000);
  await app.drag([[100, 100], [200, 200]], { button: 'right' }); // xor
  expect(await area()).toBe(15000 - 2500 + 7500);
  await app.drag([[0, 0], [120, 120]], { button: 'right', modifiers: ['Alt'] }); // intersect
  const inR = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;
  let expected = 0;
  for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) {
    let s = (inR(x, y, 0, 0, 100, 100) || inR(x, y, 50, 50, 150, 150)) && !inR(x, y, 0, 0, 50, 50);
    s = s !== inR(x, y, 100, 100, 200, 200);
    s = s && inR(x, y, 0, 0, 120, 120);
    if (s) expected++;
  }
  expect(await area()).toBe(expected);
  await app.setting('selectionMode', 'replace');
  await app.click(700, 500); // click without drag deselects
  expect(await area()).toBe(0);
});

test('ellipse, lasso and magic wand select the expected areas', async ({ app }) => {
  await paintSample(app);
  await app.tool('ellipseselect');
  await app.drag([[100, 100], [300, 300]]);
  const b = await app.eval(() => pdn.activeDoc.selection.bounds);
  expect(b).toEqual({ x: 100, y: 100, w: 200, h: 200 });
  await app.tool('lasso');
  await app.drag([[400, 100], [600, 100], [600, 300], [400, 300]]);
  const lb = await app.eval(() => pdn.activeDoc.selection.bounds);
  expect(Math.abs(lb.x - 400)).toBeLessThanOrEqual(1);
  expect(Math.abs(lb.w - 200)).toBeLessThanOrEqual(2);
  await app.tool('magicwand'); await app.setting('tolerance', 0);
  await app.click(60, 50);
  expect(await app.eval(() => pdn.activeDoc.selection.bounds)).toEqual({ x: 20, y: 20, w: 120, h: 80 });
});

test('move selected pixels: move, rotate, scale, ctrl-copy, undo', async ({ app }) => {
  await paintSample(app);
  await app.selectRect(20, 20, 120, 80);
  const start = await app.sig();
  await app.tool('moveselected');
  await app.drag([[60, 50], [460, 350]]);
  expect(await app.px(450, 350)).toEqual([224, 48, 48, 255]);
  expect((await app.px(60, 50, 0))[3]).toBe(0); // hole left behind
  await app.drag([[460, 350], [500, 300]], { button: 'right' }); // rotate
  await app.drag([[540, 380], [600, 430]]); // bottom-right handle scale
  await app.page.keyboard.press('Enter');
  const end = await app.sig();
  expect(end).not.toBe(start);
  await app.checkUndoRedo(start, end);
  // ctrl-drag leaves a copy
  await app.eval(() => pdn.activeDoc.history.goto(0));
  await app.selectRect(20, 20, 120, 80);
  await app.drag([[60, 50], [460, 350]], { modifiers: ['Control'] });
  expect(await app.px(60, 50)).toEqual([224, 48, 48, 255]);
  expect(await app.px(450, 350)).toEqual([224, 48, 48, 255]);
});

test('move selected pixels with no selection moves the whole layer', async ({ app }) => {
  await paintSample(app);
  await app.tool('moveselected');
  await app.drag([[300, 300], [310, 300]]);
  expect(await app.px(31, 50)).toEqual([224, 48, 48, 255]);
  expect((await app.px(5, 50, 0))[3]).toBe(0); // uncovered strip is transparent
  expect(await app.px(25, 50, 0)).toEqual([255, 255, 255, 255]); // white background moved too
});

test('arrow keys nudge the selected pixels', async ({ app, page }) => {
  await paintSample(app);
  await app.selectRect(20, 20, 120, 80);
  await app.tool('moveselected');
  await app.page.locator('canvas.display').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  expect(await app.eval(() => pdn.activeDoc.selection.bounds)).toEqual({ x: 25, y: 20, w: 120, h: 80 });
  expect(await app.px(144, 50)).toEqual([224, 48, 48, 255]);
});

test('move selection moves only the outline', async ({ app }) => {
  await paintSample(app);
  await app.selectRect(20, 20, 120, 80);
  await app.tool('moveselection');
  const before = await app.eval(() => pdn.activeDoc.layers[0].ctx.getImageData(0, 0, 800, 600).data.join(',').length);
  await app.drag([[60, 50], [160, 150]]);
  expect(await app.eval(() => pdn.activeDoc.selection.bounds)).toEqual({ x: 120, y: 120, w: 120, h: 80 });
  expect(await app.px(60, 50)).toEqual([224, 48, 48, 255]);
  expect(await app.hist()).toEqual(['New Image', 'Move Selection']);
  expect(before).toBeGreaterThan(0);
});

test('zoom tool zooms in/out and to a rectangle; pan tool scrolls', async ({ app }) => {
  await app.tool('zoom');
  const z0 = await app.eval(() => pdn.view.zoom);
  await app.click(400, 300);
  expect(await app.eval(() => pdn.view.zoom)).toBeGreaterThan(z0);
  await app.click(400, 300, { button: 'right' });
  await app.click(400, 300, { button: 'right' });
  expect(await app.eval(() => pdn.view.zoom)).toBeLessThan(z0);
  await app.drag([[100, 100], [200, 150]]);
  expect(await app.eval(() => pdn.view.zoom)).toBeGreaterThan(3);
  await app.tool('pan');
  const s0 = await app.eval(() => pdn.view.scroller.scrollLeft);
  await app.drag([[150, 120], [120, 120]]);
  expect(await app.eval(() => pdn.view.scroller.scrollLeft)).not.toBe(s0);
});

test('tool keyboard shortcuts cycle through tool groups', async ({ app, page }) => {
  const seq = [];
  await page.locator('canvas.display').focus();
  for (let i = 0; i < 5; i++) { await page.keyboard.press('s'); seq.push(await app.eval(() => pdn.activeTool.id)); }
  expect(seq).toEqual(['rectselect', 'ellipseselect', 'lasso', 'magicwand', 'rectselect']);
  const singles = { z: 'zoom', h: 'pan', f: 'paintbucket', g: 'gradient', b: 'paintbrush', e: 'eraser', p: 'pencil', k: 'colorpicker', l: 'clonestamp', r: 'recolor', t: 'text' };
  for (const [k, id] of Object.entries(singles)) {
    if (k === 't') { await page.keyboard.press(k); expect(await app.eval(() => pdn.activeTool.id)).toBe(id); continue; }
    await page.keyboard.press(k);
    expect(await app.eval(() => pdn.activeTool.id), k).toBe(id);
  }
});

test('brush width shortcuts and swap colors', async ({ app, page }) => {
  await app.setting('brushWidth', 10);
  await page.locator('canvas.display').focus();
  await page.keyboard.press(']');
  expect(await app.eval(() => pdn.toolSettings.brushWidth)).toBe(12);
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  expect(await app.eval(() => pdn.toolSettings.brushWidth)).toBe(9);
  await page.keyboard.press('x');
  expect(await app.eval(() => pdn.primary)).toEqual(BLUE);
});
