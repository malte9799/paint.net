import { MoveSelectedTool, MoveSelectionTool } from './move.js';
import { RectSelectTool, EllipseSelectTool, LassoSelectTool, MagicWandTool } from './select.js';
import { ZoomTool, PanTool, ColorPickerTool } from './misc.js';
import { PaintBucketTool, GradientTool } from './fill.js';
import { PaintbrushTool, EraserTool, PencilTool, CloneStampTool, RecolorTool } from './paint.js';
import { TextTool } from './text.js';
import { LineCurveTool, ShapesTool } from './shapes.js';

export const TOOL_CLASSES = [
  MoveSelectedTool, MoveSelectionTool, RectSelectTool, EllipseSelectTool, LassoSelectTool, MagicWandTool,
  ZoomTool, PanTool, PaintBucketTool, GradientTool, PaintbrushTool, EraserTool, PencilTool, ColorPickerTool,
  CloneStampTool, RecolorTool, TextTool, LineCurveTool, ShapesTool,
];

export function createTools(app) {
  const tools = new Map();
  for (const C of TOOL_CLASSES) { const t = new C(app); tools.set(t.id, t); }
  return tools;
}
