import { Tool, StrokeCompositor, PAINT_BLEND, drawHandle, HANDLE_HIT } from './common.js';
import { Rect } from '../util.js';
import { toCss } from '../color.js';

export class TextTool extends Tool {
  constructor(app) {
    super(app, {
      id: 'text', name: 'Text', icon: 't_text', key: 'T',
      hint: 'Left click to place cursor, then type desired text. Text color is primary color. Drag the handle to move the text. Press Esc or click elsewhere to finish.',
      options: ['font', 'fontSize', 'fontStyle', 'textAlign', 'antialias', 'blendMode'],
    });
    this.edit = null;
    this.keepsFocus = true;
    this.ta = document.createElement('textarea');
    this.ta.className = 'text-tool-input';
    this.ta.setAttribute('autocomplete', 'off');
    this.ta.setAttribute('spellcheck', 'false');
    document.body.appendChild(this.ta);
    const rerender = () => { if (this.edit) this.renderText(); };
    this.ta.addEventListener('input', rerender);
    this.ta.addEventListener('keyup', rerender);
    this.ta.addEventListener('select', rerender);
    this.ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.commit(); }
      e.stopPropagation(); // keep tool shortcuts from firing while typing
      setTimeout(rerender, 0);
    });
  }
  get hasPending() { return !!this.edit; }

  font() {
    const s = this.settings;
    const px = (s.fontSize * 96) / 72;
    return { css: `${s.fontStyle.italic ? 'italic ' : ''}${s.fontStyle.bold ? 'bold ' : ''}${px}px "${s.font}", sans-serif`, px };
  }
  layout() {
    const E = this.edit, ctx = E.s.mctx;
    const f = this.font();
    ctx.font = f.css;
    const lines = this.ta.value.split('\n');
    const lh = Math.ceil(f.px * 1.2);
    const widths = lines.map((l) => ctx.measureText(l).width);
    const maxW = Math.max(f.px * 0.5, ...widths);
    const align = this.settings.textAlign;
    const xOf = (w) => (align === 'center' ? E.pos.x - w / 2 : align === 'right' ? E.pos.x - w : E.pos.x);
    const left = align === 'center' ? E.pos.x - maxW / 2 : align === 'right' ? E.pos.x - maxW : E.pos.x;
    return { f, lines, lh, widths, xOf, bounds: { x: left, y: E.pos.y, w: maxW, h: lh * lines.length } };
  }
  onPointerDown(e, p) {
    if (!this.doc) return;
    if (this.edit) {
      const L = this.layout();
      const hp = this.handlePos(L);
      if (Math.hypot(hp.x - p.x, hp.y - p.y) * this.app.view.zoom <= HANDLE_HIT + 2) {
        this.moving = { start: p, pos0: { ...this.edit.pos } };
        return;
      }
      if (Rect.contains(Rect.inflate(L.bounds, 2 / this.app.view.zoom), p.x, p.y)) {
        this.placeCaret(L, p);
        return;
      }
    }
    this.commit();
    const s = new StrokeCompositor(this.doc);
    s.direct = true;
    this.edit = { s, pos: { x: Math.round(p.x), y: Math.round(p.y) }, lastRect: null };
    this.ta.value = '';
    this.focusInput();
    this.renderText();
  }
  placeCaret(L, p) {
    const row = Math.max(0, Math.min(L.lines.length - 1, Math.floor((p.y - this.edit.pos.y) / L.lh)));
    const ctx = this.edit.s.mctx;
    ctx.font = L.f.css;
    const line = L.lines[row], x0 = L.xOf(L.widths[row]);
    let col = line.length;
    for (let i = 0; i <= line.length; i++) {
      if (x0 + ctx.measureText(line.slice(0, i)).width >= p.x) {
        col = i > 0 && x0 + ctx.measureText(line.slice(0, i - 1)).width + (ctx.measureText(line[i - 1]).width / 2) > p.x ? i - 1 : i;
        break;
      }
    }
    let idx = 0;
    for (let i = 0; i < row; i++) idx += L.lines[i].length + 1;
    this.focusInput();
    this.ta.setSelectionRange(idx + col, idx + col);
    this.render();
  }
  onPointerMove(e, p) {
    if (!this.moving) return;
    this.edit.pos = { x: Math.round(this.moving.pos0.x + p.x - this.moving.start.x), y: Math.round(this.moving.pos0.y + p.y - this.moving.start.y) };
    this.renderText();
  }
  onPointerUp() { if (this.moving) { this.moving = null; this.focusInput(); } }
  focusInput() {
    const v = this.app.view;
    if (this.edit) {
      const sp = v.toScreen(this.edit.pos.x, this.edit.pos.y), r = v.display.getBoundingClientRect();
      this.ta.style.left = Math.max(0, r.left + sp.x) + 'px';
      this.ta.style.top = Math.max(0, r.top + sp.y) + 'px';
    }
    this.ta.focus({ preventScroll: true });
    setTimeout(() => this.ta.focus({ preventScroll: true }), 0);
  }
  handlePos(L) { return { x: L.bounds.x + L.bounds.w + 4 / this.app.view.zoom, y: L.bounds.y + L.bounds.h + 4 / this.app.view.zoom }; }
  onSettingChanged() { if (this.edit) { this.renderText(); this.focusInput(); } }
  onColorsChanged() { if (this.edit) this.renderText(); }
  renderText() {
    const E = this.edit, s = E.s, m = s.mctx;
    const L = this.layout();
    const st = this.settings;
    m.clearRect(0, 0, s.mask.width, s.mask.height);
    m.save();
    m.font = L.f.css;
    m.textBaseline = 'alphabetic';
    m.fillStyle = toCss({ ...this.app.primary, a: 255 });
    const asc = L.f.px * 0.9;
    L.lines.forEach((line, i) => {
      const x = L.xOf(L.widths[i]), y = E.pos.y + i * L.lh + asc;
      m.fillText(line, x, y);
      const th = Math.max(1, Math.round(L.f.px / 14));
      if (st.fontStyle.underline && line) m.fillRect(x, y + th * 1.5, L.widths[i], th);
      if (st.fontStyle.strike && line) m.fillRect(x, y - L.f.px * 0.3, L.widths[i], th);
    });
    m.restore();
    s.color = this.app.primary;
    s.mode = PAINT_BLEND[st.blendMode] || 'source-over';
    s.antialias = st.antialias;
    const rect = Rect.inflate(L.bounds, Math.ceil(L.f.px * 0.5) + 2);
    s.compose(E.lastRect ? Rect.union(E.lastRect, rect) : rect);
    E.lastRect = rect;
    this.render();
  }
  commit() {
    if (!this.edit) return;
    const E = this.edit;
    this.edit = null;
    this.ta.blur();
    if (this.ta.value.trim()) E.s.finish('Text', this.icon);
    else E.s.cancel();
    this.render();
  }
  cancel() {
    if (!this.edit) return;
    this.edit.s.cancel();
    this.edit = null;
    this.ta.blur();
    this.render();
  }
  deactivate() { this.commit(); }
  drawOverlay(ctx, view) {
    if (!this.edit) return;
    const L = this.layout();
    const b = L.bounds;
    const a = view.toScreen(b.x, b.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(Math.round(a.x) - 1.5, Math.round(a.y) - 1.5, b.w * view.zoom + 3, b.h * view.zoom + 3);
    ctx.restore();
    // caret
    if (document.activeElement === this.ta) {
      const idx = this.ta.selectionEnd;
      const before = this.ta.value.slice(0, idx).split('\n');
      const row = before.length - 1, col = before[row].length;
      const m = this.edit.s.mctx;
      m.font = L.f.css;
      const x = L.xOf(L.widths[row]) + m.measureText(L.lines[row].slice(0, col)).width;
      const c0 = view.toScreen(x, this.edit.pos.y + row * L.lh);
      ctx.fillStyle = '#000';
      ctx.fillRect(Math.round(c0.x), Math.round(c0.y), Math.max(1, Math.round(view.zoom / 2)), L.lh * view.zoom);
    }
    const hp = this.handlePos(L), hs = view.toScreen(hp.x, hp.y);
    drawHandle(ctx, hs.x, hs.y, 8);
  }
  getCursor(p) {
    if (this.edit) {
      const L = this.layout();
      const hp = this.handlePos(L);
      if (Math.hypot(hp.x - p.x, hp.y - p.y) * this.app.view.zoom <= HANDLE_HIT + 2) return 'move';
    }
    return 'text';
  }
}
