import { test, expect } from './fixtures.js';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const { DE } = await import(path.join(ROOT, 'js/lang/de.js'));

function resolve(s) {
  if (s in DE) return true;
  if ((s.endsWith('…') || s.endsWith(':')) && s.slice(0, -1) in DE) return true;
  const m = /^(.*) \(([^()]*)\)$/.exec(s);
  return !!(m && m[1] in DE);
}

test('every literal passed to t() has a German translation', () => {
  const files = fs.readdirSync(path.join(ROOT, 'js'), { recursive: true }).filter((f) => f.endsWith('.js') && !f.startsWith('lang') && f !== 'i18n.js');
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    for (const m of src.matchAll(/\bt(?:r)?\(\s*'((?:[^'\\]|\\.)+)'/g)) {
      const s = m[1].replace(/\\'/g, "'");
      if (!resolve(s)) missing.push(`${f}: ${s}`);
    }
  }
  expect(missing).toEqual([]);
});

test('data-driven labels (tools, commands, effects, options) are translated', async ({ app }) => {
  const labels = await app.eval(async () => {
    const { EFFECTS, EFFECT_MENUS } = await import('./js/effects/registry.js');
    const { SHAPES } = await import('./js/tools/shapes.js');
    const { BLEND_MODES } = await import('./js/document.js');
    const out = [];
    for (const t of pdn.tools.values()) out.push(t.name, t.hint);
    for (const c of pdn.commands.values()) out.push(c.label);
    for (const fx of Object.values(EFFECTS)) {
      out.push(fx.name);
      for (const p of fx.params || []) { if (p.label) out.push(p.label); for (const o of p.options || []) out.push(o[1]); }
    }
    out.push(...EFFECT_MENUS, ...SHAPES.map((s) => s[1]), ...BLEND_MODES.map((b) => b[1]));
    return out;
  });
  const missing = [...new Set(labels)].filter((s) => !resolve(s));
  expect(missing).toEqual([]);
});

test.describe('German UI', () => {
  test.use({ locale: 'de-DE' });

  test('menus, submenus, tool options and dialogs show no untranslated text', async ({ app, page }) => {
    const english = new Set(Object.keys(DE).filter((k) => DE[k] !== k && k.length > 2));
    const leaks = new Set();
    const scan = async (where) => {
      const texts = await page.evaluate(() => {
        const out = [];
        const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) out.push(t); } else if (c.nodeType === 1 && getComputedStyle(c).display !== 'none') { if (c.title) out.push(c.title.trim()); walk(c); } } };
        walk(document.body);
        return out;
      });
      for (const t of texts) for (const variant of [t, t.replace(/…$/, ''), t.replace(/:$/, '')]) if (english.has(variant)) leaks.add(`${where}: ${t}`);
    };
    await scan('main');
    for (const menu of await page.locator('.menu-top').allTextContents()) {
      await page.click(`.menu-top:text-is("${menu}")`);
      await scan(menu);
      const subs = await page.locator('.menu-popup >> nth=0 >> .menu-item:has(.mi-arrow .icon)').allTextContents();
      for (const s of subs) { await page.locator('.menu-popup >> nth=0').locator(`.menu-item:has-text("${s.trim()}")`).first().hover(); await page.waitForTimeout(80); await scan(menu + ' > ' + s); }
      await page.keyboard.press('Escape'); await page.mouse.click(700, 830);
    }
    for (const tool of await app.eval(() => [...pdn.tools.keys()])) { await app.tool(tool); await scan('tool ' + tool); }
    await app.tool('paintbrush');
    for (const cmd of ['file.new', 'image.resize', 'image.canvassize', 'layers.properties', 'layers.rotatezoom', 'app.settings', 'app.about', 'app.shortcuts', 'fx.curves', 'fx.levels', 'fx.dents', 'fx.polarinversion', 'fx.clouds']) {
      await app.run(cmd);
      await page.waitForTimeout(200);
      await scan(cmd);
      await app.cancelDialog();
    }
    await page.click('.swatch.primary'); await scan('color dialog'); await app.cancelDialog();
    expect([...leaks]).toEqual([]);
  });

  test('defaults and shortcuts are localized', async ({ app, page }) => {
    expect(await app.eval(() => [document.documentElement.lang, pdn.activeDoc.name, pdn.activeDoc.layers[0].name])).toEqual(['de', 'Unbenannt', 'Hintergrund']);
    await app.run('layers.add');
    expect(await app.eval(() => pdn.activeDoc.layers[1].name)).toBe('Ebene 2');
    await app.run('layers.duplicate');
    expect(await app.eval(() => pdn.activeDoc.layers[2].name)).toBe('Ebene 2 Kopie');
    await page.click('.menu-top:text-is("Bearbeiten")');
    await expect(page.locator('.menu-item:has-text("Rückgängig") .mi-shortcut')).toHaveText('Strg+Z');
  });
});
