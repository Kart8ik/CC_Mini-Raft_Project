export type BoardTool =
  | "pen"
  | "eraser"
  | "brush"
  | "spray"
  | "line"
  | "rect"
  | "circle"
  | "roundrect"
  | "polygon"
  | "curve"
  | "fill"
  | "eyedropper"
  | "text"
  | "magnifier";

export type BoardSettings = {
  color: string;
  width: number;
  tool: BoardTool;
  fillShapes: boolean;
};

export type BoardApi = {
  sendCommand: (command: "undo" | "redo" | "clear") => void;
  downloadCanvas: () => void;
  queueStroke: (stroke: Stroke) => void;
  pickColorAt: (point: Point) => string | null;
};

export type Point = { x: number; y: number };

export type Stroke = {
  tool?: string;
  points: Point[];
  color: string;
  width: number;
  filled?: boolean;
  text?: string;
  fontSize?: number;
  sprayRadius?: number;
  cornerRadius?: number;
};

export type LogEntry = {
  index?: number;
  term?: number;
  stroke: Stroke;
};

export type ToolCategory =
  | "freeform"
  | "twopoint"
  | "multiclick"
  | "multiphase"
  | "singleclick"
  | "text"
  | "viewport";

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  pen: "freeform",
  eraser: "freeform",
  brush: "freeform",
  spray: "freeform",
  line: "twopoint",
  rect: "twopoint",
  circle: "twopoint",
  roundrect: "twopoint",
  polygon: "multiclick",
  curve: "multiphase",
  fill: "singleclick",
  eyedropper: "singleclick",
  text: "text",
  magnifier: "viewport",
};

export function getToolCategory(tool: string): ToolCategory {
  return TOOL_CATEGORIES[tool] ?? "freeform";
}
