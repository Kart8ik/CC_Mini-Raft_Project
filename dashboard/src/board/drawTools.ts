import { DEFAULT_CORNER_RADIUS, DEFAULT_FONT_SIZE } from "./constants";
import { floodFill } from "./floodFill";
import type { Stroke } from "./types";

export type DrawOptions = {
  colorOverride?: string;
  preview?: boolean;
};

function toolOf(stroke: Stroke): string {
  return stroke.tool || "pen";
}

export function isCommandTool(tool: string): boolean {
  return tool === "undo" || tool === "redo" || tool === "clear";
}

type ToolRenderer = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
) => void;

function resolveColor(stroke: Stroke, opts: DrawOptions): string {
  return opts.colorOverride || stroke.color || "#161616";
}

function setupStrokeStyle(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = resolveColor(stroke, opts);
  ctx.lineWidth = stroke.width || 3;
}

/* ---------- freeform tools ---------- */

function drawFreeform(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  const pts = stroke.points;
  if (pts.length < 2) return;
  const tool = toolOf(stroke);

  setupStrokeStyle(ctx, stroke, opts);

  if (tool === "eraser" && !opts.preview) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
}

function drawBrush(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  const pts = stroke.points;
  if (pts.length < 2) return;

  setupStrokeStyle(ctx, stroke, opts);
  ctx.globalAlpha = opts.preview ? 0.4 : 0.6;
  ctx.lineWidth = (stroke.width || 3) * 2;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawSpray(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  const pts = stroke.points;
  if (pts.length < 1) return;

  const color = resolveColor(stroke, opts);
  ctx.fillStyle = color;
  ctx.globalAlpha = opts.preview ? 0.5 : 0.8;

  for (const p of pts) {
    ctx.fillRect(p.x, p.y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

/* ---------- two-point shape tools ---------- */

function drawLine(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  if (stroke.points.length < 2) return;
  const [start, end] = stroke.points;

  setupStrokeStyle(ctx, stroke, opts);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  if (stroke.points.length < 2) return;
  const [start, end] = stroke.points;

  setupStrokeStyle(ctx, stroke, opts);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  if (stroke.filled) {
    ctx.fillStyle = resolveColor(stroke, opts);
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeRect(x, y, w, h);
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  if (stroke.points.length < 2) return;
  const [start, end] = stroke.points;

  setupStrokeStyle(ctx, stroke, opts);
  const radius = Math.hypot(end.x - start.x, end.y - start.y);

  ctx.beginPath();
  ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
  if (stroke.filled) {
    ctx.fillStyle = resolveColor(stroke, opts);
    ctx.fill();
  }
  ctx.stroke();
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  if (stroke.points.length < 2) return;
  const [start, end] = stroke.points;

  setupStrokeStyle(ctx, stroke, opts);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const r = Math.min(stroke.cornerRadius ?? DEFAULT_CORNER_RADIUS, w / 2, h / 2);

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (stroke.filled) {
    ctx.fillStyle = resolveColor(stroke, opts);
    ctx.fill();
  }
  ctx.stroke();
}

/* ---------- multi-click / multi-phase tools ---------- */

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  const pts = stroke.points;
  if (pts.length < 2) return;

  setupStrokeStyle(ctx, stroke, opts);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
  if (stroke.filled) {
    ctx.fillStyle = resolveColor(stroke, opts);
    ctx.fill();
  }
  ctx.stroke();
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  const pts = stroke.points;
  if (pts.length < 2) return;

  setupStrokeStyle(ctx, stroke, opts);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else if (pts.length === 3) {
    ctx.quadraticCurveTo(pts[2].x, pts[2].y, pts[1].x, pts[1].y);
  } else {
    ctx.bezierCurveTo(
      pts[2].x,
      pts[2].y,
      pts[3].x,
      pts[3].y,
      pts[1].x,
      pts[1].y,
    );
  }
  ctx.stroke();
}

/* ---------- text tool ---------- */

function drawText(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions,
): void {
  if (!stroke.text || stroke.points.length < 1) return;

  const size = stroke.fontSize ?? DEFAULT_FONT_SIZE;
  const color = resolveColor(stroke, opts);
  const { x, y } = stroke.points[0];
  ctx.font = `${size}px "Microsoft Sans Serif", Tahoma, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";

  const lines = stroke.text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * size * 1.2);
  }
}

/* ---------- fill (flood fill) tool ---------- */

function drawFillTool(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  _opts: DrawOptions,
): void {
  if (stroke.points.length < 1) return;
  const { x, y } = stroke.points[0];
  floodFill(ctx, Math.round(x), Math.round(y), stroke.color);
}

/* ---------- registry ---------- */

const TOOL_RENDERERS: Record<string, ToolRenderer> = {
  pen: drawFreeform,
  eraser: drawFreeform,
  brush: drawBrush,
  spray: drawSpray,
  line: drawLine,
  rect: drawRect,
  circle: drawCircle,
  roundrect: drawRoundRect,
  polygon: drawPolygon,
  curve: drawCurve,
  text: drawText,
  fill: drawFillTool,
};

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: DrawOptions = {},
): void {
  const tool = toolOf(stroke);
  if (isCommandTool(tool)) return;
  if (!stroke.points || stroke.points.length < 1) {
    if (tool !== "fill") return;
  }

  ctx.save();
  const renderer = TOOL_RENDERERS[tool] ?? TOOL_RENDERERS.pen;
  renderer(ctx, stroke, opts);
  ctx.restore();
}
