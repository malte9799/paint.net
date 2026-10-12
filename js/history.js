import { Emitter, createCanvas } from './util.js';

const MAX_ITEMS = 250;

// Linear undo/redo stack. items[0] is the base state ("New Image", "Open Image"), never undone.
export class History extends Emitter {
  constructor(baseName = 'New Image', baseIcon = 'new') {
    super();
    this.items = [{ name: baseName, icon: baseIcon, undo() {}, redo() {} }];
    this.current = 0;
  }
  get canUndo() { return this.current > 0; }
  get canRedo() { return this.current < this.items.length - 1; }
  get top() { return this.items[this.current]; }

  push(item) {
    this.items.splice(this.current + 1);
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) {
      // Fold the oldest undoable item into the base state.
      this.items.splice(1, 1);
    }
    this.current = this.items.length - 1;
    this.emit('change');
  }
  undo() {
    if (!this.canUndo) return false;
    this.items[this.current].undo();
    this.current--;
    this.emit('change');
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this.current++;
    this.items[this.current].redo();
    this.emit('change');
    return true;
  }
  goto(index) {
    while (this.current > index && this.undo());
    while (this.current < index && this.redo());
  }
  clear(baseName, baseIcon) {
    this.items = [{ name: baseName || this.items[0].name, icon: baseIcon || this.items[0].icon, undo() {}, redo() {} }];
    this.current = 0;
    this.emit('change');
  }
}

// Creates an undo item for a pixel change in one layer. `before` is a canvas or ImageData
// holding the layer state before the change (full layer size canvas, or ImageData of rect).
export function pixelItem(doc, layer, rect, before, name, icon, extra) {
  const x = rect.x, y = rect.y;
  const beforeData = before instanceof ImageData ? before : before.getContext('2d').getImageData(x, y, rect.w, rect.h);
  const afterData = layer.ctx.getImageData(x, y, rect.w, rect.h);
  return {
    name, icon,
    undo() {
      layer.ctx.putImageData(beforeData, x, y);
      extra?.undo?.();
      doc.invalidate(rect);
    },
    redo() {
      layer.ctx.putImageData(afterData, x, y);
      extra?.redo?.();
      doc.invalidate(rect);
    },
  };
}

// Snapshot of a whole document's geometry + layer canvases + selection (for image-wide ops).
export function docSnapshot(doc) {
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((l) => ({ layer: l, canvas: l.canvas })),
    active: doc.activeIndex,
    selection: doc.selection.snapshot(),
  };
}

export function restoreDocSnapshot(doc, s) {
  doc.width = s.width;
  doc.height = s.height;
  doc.layers = s.layers.map(({ layer, canvas }) => { layer.canvas = canvas; return layer; });
  doc.activeIndex = Math.min(s.active, doc.layers.length - 1);
  doc.selection.resize(s.width, s.height);
  doc.selection.restore(s.selection);
  doc.compositeResized();
  doc.emit('size');
  doc.emit('layers');
  doc.invalidate();
}

// Run an operation that replaces layer canvases (never mutating old ones) and record it.
export function recordDocOp(doc, name, icon, fn) {
  const before = docSnapshot(doc);
  fn();
  const after = docSnapshot(doc);
  doc.history.push({
    name, icon,
    undo: () => restoreDocSnapshot(doc, before),
    redo: () => restoreDocSnapshot(doc, after),
  });
}

// Undo item for a layer-structure change. `apply(state)` restores a structural state.
export function layersItem(doc, name, icon, beforeState, afterState) {
  return {
    name, icon,
    undo: () => restoreLayers(doc, beforeState),
    redo: () => restoreLayers(doc, afterState),
  };
}

export function layersState(doc) {
  return {
    layers: [...doc.layers],
    active: doc.activeIndex,
    props: doc.layers.map((l) => ({ name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, canvas: l.canvas })),
  };
}

function restoreLayers(doc, s) {
  doc.layers = [...s.layers];
  s.layers.forEach((l, i) => Object.assign(l, s.props[i]));
  doc.activeIndex = s.active;
  doc.emit('layers');
  doc.invalidate();
}

export { createCanvas };
