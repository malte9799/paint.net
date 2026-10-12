import { test, expect } from './fixtures.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NO_DIALOG_CMDS = ['edit.selectall', 'edit.deselect', 'edit.invertsel', 'edit.erase', 'edit.fill', 'image.fliph', 'image.flipv',
  'image.rotcw', 'image.rotccw', 'image.rot180', 'image.crop', 'image.flatten', 'layers.add', 'layers.duplicate', 'layers.merge',
  'layers.delete', 'layers.up', 'layers.down', 'layers.fliph', 'layers.flipv', 'fx.invert', 'fx.sepia', 'fx.blackwhite', 'fx.autolevel'];

async function randomOp(app, r) {
  const W = await app.eval(() => pdn.activeDoc.width), H = await app.eval(() => pdn.activeDoc.height);
  const pt = () => [Math.floor(r() * (W + 40)) - 20, Math.floor(r() * (H + 40)) - 20];
  const color = () => ({ r: Math.floor(r() * 256), g: Math.floor(r() * 256), b: Math.floor(r() * 256), a: r() < 0.3 ? Math.floor(r() * 255) : 255 });
  const k = Math.floor(r() * 12);
  if (k <= 4) {
    const cmd = NO_DIALOG_CMDS[Math.floor(r() * NO_DIALOG_CMDS.length)];
    await app.eval((c) => pdn.run(c), cmd);
    await app.page.waitForTimeout(30);
    return cmd;
  }
  if (k === 5) {
    const tool = ['paintbrush', 'eraser', 'pencil'][Math.floor(r() * 3)];
    await app.tool(tool); await app.__step?.('tool'); await app.primary(color()); await app.__step?.('primary'); await app.setting('brushWidth', 1 + Math.floor(r() * 30)); await app.__step?.('setting');
    await app.setting('antialias', r() < 0.7); await app.__step?.('setting');
    await app.drag([pt(), pt(), pt()], { steps: 3 }); await app.__step?.('drag');
    return tool;
  }
  if (k === 6) {
    const tool = ['rectselect', 'ellipseselect'][Math.floor(r() * 2)];
    await app.tool(tool); await app.__step?.('tool');
    await app.setting('selectionMode', ['replace', 'union', 'exclude', 'xor', 'intersect'][Math.floor(r() * 5)]); await app.__step?.('setting');
    await app.drag([pt(), pt()], { steps: 2 }); await app.__step?.('drag');
    return tool;
  }
  if (k === 7) {
    await app.tool('shapes'); await app.__step?.('tool'); await app.primary(color()); await app.__step?.('primary');
    await app.setting('shapeType', ['rectangle', 'ellipse', 'star5', 'heart'][Math.floor(r() * 4)]); await app.__step?.('setting');
    await app.setting('shapeDraw', ['outline', 'fill', 'both'][Math.floor(r() * 3)]); await app.__step?.('setting');
    await app.drag([pt(), pt()], { steps: 2 }); await app.__step?.('drag');
    await app.page.keyboard.press('Enter');
    return 'shapes';
  }
  if (k === 8) {
    await app.tool('gradient'); await app.__step?.('tool'); await app.setting('gradientType', ['linear', 'radial', 'diamond'][Math.floor(r() * 3)]); await app.__step?.('setting');
    await app.setting('gradientMode', r() < 0.5 ? 'color' : 'transparency'); await app.__step?.('setting');
    await app.drag([pt(), pt()], { steps: 2 }); await app.__step?.('drag');
    await app.page.keyboard.press('Enter');
    return 'gradient';
  }
  if (k === 9) {
    await app.tool('moveselected'); await app.__step?.('tool');
    await app.drag([pt(), pt()], { steps: 2, button: r() < 0.2 ? 'right' : 'left' }); await app.__step?.('drag');
    return 'move';
  }
  if (k === 10) {
    await app.tool('paintbucket'); await app.__step?.('tool'); await app.primary(color()); await app.__step?.('primary'); await app.setting('floodMode', r() < 0.5 ? 'global' : 'contiguous'); await app.__step?.('setting');
    await app.click(...pt()); await app.__step?.('click');
    return 'bucket';
  }
  const nw = 50 + Math.floor(r() * 300), nh = 50 + Math.floor(r() * 250);
  const anchor = [[0, 0], [0.5, 0.5], [1, 1]][Math.floor(r() * 3)];
  await app.eval(([w, h, a]) => { pdn.commitTool(); pdn.resizeCanvas(pdn.activeDoc, w, h, a, 'Canvas Size'); }, [nw, nh, anchor]);
  return 'canvassize';
}

for (const [seed, roundTrip] of [[1, true], [7, false], [42, false], [1234, true], [99, false], [2024, true]]) {
  test(`history fuzz seed ${seed}${roundTrip ? ' (round trips)' : ''}: every history step reproduces its exact state`, async ({ app }) => {
    test.setTimeout(240_000);
    await app.newDoc(300, 200, '#ffffff');
    await app.eval(() => pdn.setActiveDocument(pdn.documents[1]));
    const r = rng(seed);
    const states = new Map();
    const record = async () => {
      await app.eval(() => pdn.commitTool());
      const i = await app.histIndex();
      states.set(i, await app.sig());
    };
    await record();
    const log = [];
    const pixels = () => app.eval(() => pdn.activeDoc.layers.map((l) => Array.from(l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height).data)));
    let prevSig = await app.sig(), prevPix = await pixels(), prevTop = 0;
    for (let n = 0; n < 45; n++) {
      log.push(await randomOp(app, r));
      await app.eval(() => pdn.commitTool());
      const top = await app.histIndex();
      // the history may have been truncated by new items: drop stale entries
      for (const k of [...states.keys()]) if (k >= top) states.delete(k);
      await record();
      const cur = await app.sig();
      if (top === prevTop + 1) {
        // A pixel item must cover every pixel the operation changed.
        const rect = await app.eval(() => pdn.activeDoc.history.top.rect || null);
        const now = await pixels();
        if (rect && now.length === prevPix.length && now.every((L, i) => L.length === prevPix[i].length)) {
          const W = await app.eval(() => pdn.activeDoc.width);
          const outside = [];
          now.forEach((L, li) => { for (let i = 0; i < L.length; i += 4) for (let k = 0; k < 4; k++) if (L[i + k] !== prevPix[li][i + k]) { const p = i >> 2, x = p % W, y = (p / W) | 0; if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) { outside.push([li, x, y]); break; } } });
          expect(outside.length, `op ${log.at(-1)} changed pixels outside its undo rect ${JSON.stringify(rect)}, e.g. ${JSON.stringify(outside.slice(0, 3))}; ops: ${log.join(', ')}`).toBe(0);
        }
        // Immediate undo/redo round trip (only for some seeds: it ends move sessions, which
        // would hide bugs in multi-step Move Selected Pixels sessions)
        if (roundTrip) {
        await app.eval(() => pdn.activeDoc.history.undo());
        expect(await app.sig(), `undo of ${log.at(-1)} (ops: ${log.join(', ')})`).toBe(prevSig);
        await app.eval(() => pdn.activeDoc.history.redo());
        expect(await app.sig(), `redo of ${log.at(-1)}`).toBe(cur);
        }
      }
      prevSig = cur; prevPix = await pixels(); prevTop = top;
    }
    const maxI = await app.eval(() => pdn.activeDoc.history.items.length - 1);
    // walk backwards, forwards, then random jumps
    const order = [];
    for (let i = maxI; i >= 0; i--) order.push(i);
    for (let i = 0; i <= maxI; i++) order.push(i);
    for (let j = 0; j < 25; j++) order.push(Math.floor(r() * (maxI + 1)));
    const names = await app.eval(() => pdn.activeDoc.history.items.map((x, i) => i + ':' + x.name));
    for (const [step, i] of order.entries()) {
      if (!states.has(i)) continue;
      await app.eval((i) => pdn.activeDoc.history.goto(i), i);
      const ok = (await app.sig()) === states.get(i);
      if (!ok) console.log(`MISMATCH at walk step ${step} (index ${i}, ${step <= maxI ? 'backward' : step <= 2 * maxI + 1 ? 'forward' : 'jump'})\n  history: ${names.join(' | ')}`);
      expect(await app.sig(), `state at history index ${i} after ops: ${log.join(', ')}`).toBe(states.get(i));
    }
  });
}
