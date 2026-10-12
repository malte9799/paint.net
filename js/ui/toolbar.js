import { h, icon, clear } from './dom.js';
import { dropdown, SEP } from './menubar.js';
import { debounce } from '../util.js';
import { t, tKeys } from '../i18n.js';

export class TopBar {
  constructor(app, host) {
    this.app = app;
    // Right side of the title/menu row: window toggles, settings, help
    this.toggles = {};
    const tog = (w, label, key) => {
      const b = h('button.tb-btn.toggle', { title: `${t(label)} (${key})`, onclick: () => app.run('window.' + w) }, icon(w));
      this.toggles[w] = b;
      return b;
    };
    this.right = h('div.titlebar-right',
      tog('tools', 'Tools', 'F5'), tog('history', 'History', 'F6'), tog('layers', 'Layers', 'F7'), tog('colors', 'Colors', 'F8'),
      h('div.tb-sep'),
      h('button.tb-btn', { title: t('Settings'), onclick: () => app.run('app.settings') }, icon('settings')),
      h('button.tb-btn.dropdown-btn', { title: t('Help'), onclick: (e) => dropdown(app, e.currentTarget, ['app.shortcuts', 'app.website', SEP, 'app.about']) }, icon('help')));
    host.appendChild(this.right);
    app.on('windows', () => this.update());
    this.update();
  }
  update() {
    for (const [w, b] of Object.entries(this.toggles)) b.classList.toggle('active', !!this.app.windows[w]?.visible);
  }
}

export class MainToolbar {
  constructor(app, host) {
    this.app = app;
    this.btns = {};
    const B = (cmd, extraCls = '') => {
      const c = app.commands.get(cmd);
      const b = h('button.tb-btn' + extraCls, { title: t(c.label.replace(/…$/, '')) + (c.shortcut ? ` (${tKeys(c.shortcut)})` : ''), onclick: () => app.run(cmd) }, icon(c.icon));
      this.btns[cmd] = b;
      return b;
    };
    const S = () => h('div.tb-sep');
    this.left = h('div.toolbar-left',
      B('file.new'), B('file.open'), B('file.save'), S(),
      B('edit.cut'), B('edit.copy'), B('edit.paste'), S(),
      B('image.crop'), B('edit.deselect'), S(),
      B('edit.undo'), B('edit.redo'), S(),
      B('view.grid', '.toggle'), B('view.rulers', '.toggle'));
    this.tabs = h('div.image-tabs', { role: 'tablist' });
    this.el = h('div.toolbar', this.left, this.tabs);
    host.appendChild(this.el);
    const upd = () => this.update();
    for (const ev of ['activedoc', 'docs', 'history', 'selection', 'settings', 'tool', 'clipboard', 'layers']) app.on(ev, upd);
    this.renderTabs = debounce(() => this._renderTabs(), 120);
    app.on('docs', () => this._renderTabs());
    app.on('activedoc', () => this._renderTabs());
    app.on('pixels', () => this.renderTabs());
    app.on('meta', () => this._renderTabs());
    this.update();
  }
  update() {
    for (const [id, b] of Object.entries(this.btns)) {
      const c = this.app.commands.get(id);
      b.disabled = !c.enabled();
      if (c.checked) b.classList.toggle('active', !!c.checked());
    }
  }
  _renderTabs() {
    const app = this.app;
    clear(this.tabs);
    for (const d of app.documents) {
      const th = d.thumbnail(56);
      th.className = 'tab-thumb';
      const close = h('button.tab-close', { title: t('Close'), onclick: (e) => { e.stopPropagation(); app.closeDocument(d); } }, icon('close'));
      const tab = h('div.image-tab' + (d === app.activeDoc ? '.active' : '') + (d.dirty ? '.dirty' : ''),
        { role: 'tab', title: d.name + (d.dirty ? ' *' : ''), onclick: () => app.setActiveDocument(d), onauxclick: (e) => { if (e.button === 1) app.closeDocument(d); } },
        h('div.tab-thumb-wrap', th), close);
      this.tabs.appendChild(tab);
    }
    const act = this.tabs.querySelector('.active');
    act?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}
