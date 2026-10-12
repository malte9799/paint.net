import { h, icon, clear } from './dom.js';
import { EFFECTS, EFFECT_MENUS } from '../effects/registry.js';
import { listRecent, deserializeDoc } from '../storage.js';

const SEP = '-';

export function menuDefs(app) {
  const adjustments = Object.values(EFFECTS).filter((f) => f.menu === 'adjustments').map((f) => 'fx.' + f.id);
  const effects = ['fx.repeat', SEP, ...EFFECT_MENUS.map((cat) => ({
    label: cat, icon: Object.values(EFFECTS).find((f) => f.menu === cat)?.icon,
    items: Object.values(EFFECTS).filter((f) => f.menu === cat).map((f) => 'fx.' + f.id),
  }))];
  return [
    { label: 'File', items: ['file.new', 'file.open', { label: 'Open Recent', icon: 'open', items: () => recentItems(app) }, SEP, 'file.save', 'file.saveas', 'file.saveall', SEP, 'file.print', SEP, 'file.close', 'file.closeall'] },
    { label: 'Edit', items: ['edit.undo', 'edit.redo', SEP, 'edit.cut', 'edit.copy', 'edit.copymerged', 'edit.paste', 'edit.pastelayer', 'edit.pasteimage', SEP, 'edit.selectall', 'edit.deselect', SEP, 'edit.erase', 'edit.fill', 'edit.invertsel', SEP, 'edit.selectallimages', 'edit.deselectallimages', SEP, 'edit.resetpalette'] },
    { label: 'View', items: ['view.zoomin', 'view.zoomout', 'view.fit', 'view.zoomsel', 'view.actual', SEP, 'view.grid', 'view.rulers', { label: 'Units', items: ['view.units.px', 'view.units.in', 'view.units.cm'] }, SEP, { label: 'Windows', items: ['window.tools', 'window.history', 'window.layers', 'window.colors', SEP, 'window.reset'] }, SEP, 'window.next', 'window.prev'] },
    { label: 'Image', items: ['image.crop', 'image.resize', 'image.canvassize', SEP, 'image.fliph', 'image.flipv', SEP, 'image.rotcw', 'image.rotccw', 'image.rot180', SEP, 'image.flatten'] },
    { label: 'Layers', items: ['layers.add', 'layers.delete', 'layers.duplicate', 'layers.merge', SEP, 'layers.import', SEP, 'layers.fliph', 'layers.flipv', 'layers.rotatezoom', SEP, 'layers.up', 'layers.down', SEP, 'layers.properties'] },
    { label: 'Adjustments', items: adjustments },
    { label: 'Effects', items: effects },
  ];
}

async function recentItems(app) {
  const list = await listRecent();
  if (!list.length) return [{ label: '(No recent images)', disabled: true }];
  return list.map((rec) => ({
    label: rec.name, thumb: rec.thumb,
    run: async () => { const d = await deserializeDoc(rec, { newId: true }); app.addDocument(d); },
  }));
}

let openMenu = null;

export class MenuBar {
  constructor(app, host) {
    this.app = app;
    this.el = h('nav.menubar', { role: 'menubar' });
    this.active = null;
    this.defs = menuDefs(app);
    this.buttons = this.defs.map((m, i) => {
      const b = h('button.menu-top', { role: 'menuitem', dataset: { i } }, m.label);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (this.active === i) this.close(); else this.open(i); });
      b.addEventListener('pointerenter', () => { if (this.active != null && this.active !== i) this.open(i); });
      return b;
    });
    this.el.append(...this.buttons);
    host.appendChild(this.el);
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu-popup') && !e.target.closest('.menubar') && !e.target.closest('.dropdown-btn')) closeAllMenus(); });
    window.addEventListener('blur', () => closeAllMenus());
  }
  open(i) {
    closeAllMenus();
    this.active = i;
    this.buttons[i].classList.add('open');
    const r = this.buttons[i].getBoundingClientRect();
    openMenu = showPopup(this.app, this.defs[i].items, r.left, r.bottom, () => { this.buttons[i].classList.remove('open'); this.active = null; });
  }
  close() { closeAllMenus(); }
}

export function closeAllMenus() {
  if (openMenu) { const m = openMenu; openMenu = null; m.close(); }
}

// Shows a popup menu at (x,y). items are command ids, SEP, or {label, icon, items | run, checked, disabled}.
export function showPopup(app, items, x, y, onClose, parent = null) {
  const popup = h('div.menu-popup', { role: 'menu' });
  let sub = null;
  const ctl = {
    el: popup,
    close() {
      sub?.close();
      popup.remove();
      if (!parent) onClose?.();
    },
  };
  const build = async () => {
    const resolved = typeof items === 'function' ? await items() : items;
    clear(popup);
    for (const it of resolved) {
      if (it === SEP) { popup.appendChild(h('div.menu-sep')); continue; }
      let cfg;
      if (typeof it === 'string') {
        const c = app.commands.get(it);
        if (!c) continue;
        cfg = { label: c.labelFn ? c.labelFn() : c.label, icon: c.icon, shortcut: c.shortcut, checked: c.checked?.(), disabled: !c.enabled(), run: () => app.run(it) };
      } else cfg = { ...it, checked: typeof it.checked === 'function' ? it.checked() : it.checked };
      const row = h('div.menu-item' + (cfg.disabled ? '.disabled' : ''), { role: 'menuitem' },
        h('span.mi-icon', cfg.checked ? icon('check') : cfg.thumb ? thumbImg(cfg.thumb) : cfg.icon ? icon(cfg.icon) : null),
        h('span.mi-label', cfg.label),
        h('span.mi-shortcut', cfg.shortcut || ''),
        h('span.mi-arrow', cfg.items ? icon('chevright') : null));
      if (cfg.items) {
        const openSub = () => {
          if (sub && sub._row === row) return;
          sub?.close();
          const r = row.getBoundingClientRect();
          sub = showPopup(app, cfg.items, r.right - 2, r.top - 4, null, ctl);
          sub._row = row;
          popup.querySelectorAll('.menu-item.sub-open').forEach((e) => e.classList.remove('sub-open'));
          row.classList.add('sub-open');
        };
        row.addEventListener('pointerenter', openSub);
        row.addEventListener('click', openSub);
      } else {
        row.addEventListener('pointerenter', () => { sub?.close(); sub = null; popup.querySelectorAll('.menu-item.sub-open').forEach((e) => e.classList.remove('sub-open')); });
        if (!cfg.disabled) row.addEventListener('click', () => { closeAllMenus(); if (parent) parent.close(); cfg.run?.(); });
      }
      popup.appendChild(row);
    }
    // keep on screen
    const r = popup.getBoundingClientRect();
    if (r.right > innerWidth) popup.style.left = Math.max(0, parent ? x - r.width - (parent.el.getBoundingClientRect().width - 4) : innerWidth - r.width - 4) + 'px';
    if (r.bottom > innerHeight) popup.style.top = Math.max(0, innerHeight - r.height - 4) + 'px';
  };
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
  document.body.appendChild(popup);
  build();
  if (parent) { const pc = parent.close; parent.close = () => { ctl.close(); pc(); }; }
  return ctl;
}

function thumbImg(blob) {
  const img = h('img.mi-thumb');
  img.src = URL.createObjectURL(blob);
  img.onload = () => URL.revokeObjectURL(img.src);
  return img;
}

// Standalone dropdown (used by toolbar icons like Settings/Help)
export function dropdown(app, anchorEl, items) {
  closeAllMenus();
  const r = anchorEl.getBoundingClientRect();
  anchorEl.classList.add('open');
  openMenu = showPopup(app, items, r.left, r.bottom, () => anchorEl.classList.remove('open'));
  return openMenu;
}

export { SEP };
