import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { DEFAULT_BOARD_SETTINGS, DEFAULT_CORNER_RADIUS, DEFAULT_FONT_SIZE, DEFAULT_SPRAY_RADIUS, ZOOM_LEVELS } from "./constants";
import { drawStroke, isCommandTool } from "./drawTools";
import type { BoardApi, BoardSettings, LogEntry, Point, Stroke } from "./types";
import { getToolCategory } from "./types";

export type EngineCallbacks = {
  onConnectionStatus: (text: string) => void;
  onUndoRedoState: (canUndo: boolean, canRedo: boolean) => void;
  onPickColor: (hex: string) => void;
  onTextStart: (position: Point, fontSize: number) => void;
  onZoomChange: (zoom: number) => void;
};

function toolOf(stroke: Stroke): string {
  return stroke.tool || "pen";
}

function flattenEvents(baseEntries: LogEntry[], pending: Map<string, Stroke>) {
  const events: { stroke: Stroke; pending: boolean }[] = [];
  for (const entry of baseEntries) {
    events.push({ stroke: entry.stroke, pending: false });
  }
  for (const stroke of pending.values()) {
    events.push({ stroke, pending: true });
  }
  return events;
}

function resolveVisibleDraws(events: { stroke: Stroke; pending: boolean }[]) {
  const visible: { stroke: Stroke; pending: boolean }[] = [];
  const redoStack: { stroke: Stroke; pending: boolean }[] = [];

  for (const event of events) {
    const tool = toolOf(event.stroke);

    if (tool === "undo") {
      if (visible.length > 0) redoStack.push(visible.pop()!);
      continue;
    }
    if (tool === "redo") {
      if (redoStack.length > 0) visible.push(redoStack.pop()!);
      continue;
    }
    if (tool === "clear") {
      visible.length = 0;
      redoStack.length = 0;
      continue;
    }

    visible.push(event);
    redoStack.length = 0;
  }

  return { visible, canUndo: visible.length > 0, canRedo: redoStack.length > 0 };
}

function wsUrl(): string {
  const isSecure = location.protocol === "https:";
  const proto = isSecure ? "wss" : "ws";
  return `${proto}://${location.hostname}:3000/ws`;
}

export function useBoardEngine(
  canvas: HTMLCanvasElement | null,
  settingsRef: RefObject<BoardSettings | null>,
  apiRef: RefObject<BoardApi | null>,
  callbacks: EngineCallbacks,
): void {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!canvas) return;
    const board = canvas;
    const ctxMaybe = board.getContext("2d", { willReadFrequently: true });
    if (!ctxMaybe) return;
    const surface: CanvasRenderingContext2D = ctxMaybe;

    const pending = new Map<string, Stroke>();
    let committed: LogEntry[] = [];
    let currentStroke: Stroke | null = null;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Polygon multi-click state
    let polygonPoints: Point[] = [];

    // Curve multi-phase state: 0=draw line, 1=set cp1, 2=set cp2
    let curvePhase = 0;
    let curveStroke: Stroke | null = null;

    // Spray interval
    let sprayInterval: ReturnType<typeof setInterval> | null = null;
    let sprayCenter: Point = { x: 0, y: 0 };

    // Zoom/pan state
    let zoomLevel = 1;
    let panOffset: Point = { x: 0, y: 0 };

    function readSettings(): BoardSettings {
      return settingsRef.current ?? DEFAULT_BOARD_SETTINGS;
    }

    function refreshUndoRedoUi() {
      const state = resolveVisibleDraws(flattenEvents(committed, pending));
      callbacksRef.current.onUndoRedoState(state.canUndo, state.canRedo);
    }

    function resizeCanvas() {
      const ratio = window.devicePixelRatio || 1;
      const width = board.clientWidth;
      const height = board.clientHeight;
      board.width = Math.floor(width * ratio);
      board.height = Math.floor(height * ratio);
      surface.setTransform(
        ratio * zoomLevel, 0,
        0, ratio * zoomLevel,
        -panOffset.x * ratio * zoomLevel,
        -panOffset.y * ratio * zoomLevel,
      );
    }

    function redrawBase(baseEntries: LogEntry[]) {
      const ratio = window.devicePixelRatio || 1;
      surface.save();
      surface.setTransform(1, 0, 0, 1, 0, 0);
      surface.clearRect(0, 0, board.width, board.height);
      surface.restore();

      // Reset transform for drawing
      surface.setTransform(
        ratio * zoomLevel, 0,
        0, ratio * zoomLevel,
        -panOffset.x * ratio * zoomLevel,
        -panOffset.y * ratio * zoomLevel,
      );

      const state = resolveVisibleDraws(flattenEvents(baseEntries, pending));
      for (const event of state.visible) {
        if (event.pending) {
          drawStroke(surface, event.stroke, {
            colorOverride: toolOf(event.stroke) === "eraser" ? "#55555588" : "#ef4444aa",
            preview: true,
          });
        } else {
          drawStroke(surface, event.stroke);
        }
      }

      callbacksRef.current.onUndoRedoState(state.canUndo, state.canRedo);
    }

    function connect() {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws = new WebSocket(wsUrl());

      ws.addEventListener("open", () => {
        callbacksRef.current.onConnectionStatus("Connected");
      });

      ws.addEventListener("close", () => {
        callbacksRef.current.onConnectionStatus("Reconnecting...");
        reconnectTimer = setTimeout(connect, 900);
      });

      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as {
          type: string;
          entries?: LogEntry[];
          logIndex?: number;
          stroke?: Stroke;
        };

        if (message.type === "init" && message.entries) {
          committed = message.entries;
          redrawBase(committed);
          return;
        }

        if (message.type === "committed" && message.stroke !== undefined && message.logIndex !== undefined) {
          committed.push({ index: message.logIndex, term: 0, stroke: message.stroke });
          for (const [localId, stroke] of pending.entries()) {
            if (JSON.stringify(stroke) === JSON.stringify(message.stroke)) {
              pending.delete(localId);
              break;
            }
          }
          redrawBase(committed);
        }
      });
    }

    function queueStroke(stroke: Stroke) {
      const localId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      pending.set(localId, stroke);
      redrawBase(committed);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stroke", stroke, localId }));
      }
    }

    function sendCommand(commandTool: "undo" | "redo" | "clear") {
      queueStroke({ tool: commandTool, points: [], color: "#161616", width: 1 });
    }

    function snappedLinePoint(start: Point, point: Point): Point {
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      const angle = Math.atan2(dy, dx);
      const step = Math.PI / 4;
      const snapped = Math.round(angle / step) * step;
      const length = Math.hypot(dx, dy);
      return {
        x: start.x + Math.cos(snapped) * length,
        y: start.y + Math.sin(snapped) * length,
      };
    }

    function downloadCanvas() {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = board.width;
      exportCanvas.height = board.height;
      const exportCtx = exportCanvas.getContext("2d")!;
      exportCtx.fillStyle = "#ffffff";
      exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      exportCtx.drawImage(board, 0, 0);

      const link = document.createElement("a");
      link.href = exportCanvas.toDataURL("image/png");
      link.download = `raft-board-${Date.now()}.png`;
      link.click();
    }

    function pointFromEvent(e: PointerEvent | MouseEvent): Point {
      const rect = board.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      return {
        x: rawX / zoomLevel + panOffset.x,
        y: rawY / zoomLevel + panOffset.y,
      };
    }

    function pickColorAt(point: Point): string | null {
      const ratio = window.devicePixelRatio || 1;
      const px = Math.round((point.x - panOffset.x) * zoomLevel * ratio + panOffset.x * zoomLevel * ratio);
      const py = Math.round((point.y - panOffset.y) * zoomLevel * ratio + panOffset.y * zoomLevel * ratio);
      if (px < 0 || px >= board.width || py < 0 || py >= board.height) return null;
      const pixel = surface.getImageData(px, py, 1, 1).data;
      if (pixel[3] === 0) return "#ffffff";
      const hex = `#${pixel[0].toString(16).padStart(2, "0")}${pixel[1].toString(16).padStart(2, "0")}${pixel[2].toString(16).padStart(2, "0")}`;
      return hex;
    }

    // ----- spray helper -----
    function generateSprayDots(center: Point, radius: number, count: number): Point[] {
      const dots: Point[] = [];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius;
        dots.push({
          x: center.x + Math.cos(angle) * dist,
          y: center.y + Math.sin(angle) * dist,
        });
      }
      return dots;
    }

    function startSpray() {
      if (sprayInterval) clearInterval(sprayInterval);
      sprayInterval = setInterval(() => {
        if (!currentStroke) return;
        const radius = currentStroke.sprayRadius ?? DEFAULT_SPRAY_RADIUS;
        const dots = generateSprayDots(sprayCenter, radius, 8);
        currentStroke.points.push(...dots);
        redrawBase(committed);
        drawStroke(surface, currentStroke, {
          colorOverride: `${currentStroke.color}cc`,
          preview: true,
        });
      }, 50);
    }

    function stopSpray() {
      if (sprayInterval) {
        clearInterval(sprayInterval);
        sprayInterval = null;
      }
    }

    // ----- polygon helpers -----
    function resetPolygon() {
      polygonPoints = [];
    }

    function previewPolygon(cursorPt: Point) {
      if (polygonPoints.length < 1) return;
      const s = readSettings();
      redrawBase(committed);

      const previewStroke: Stroke = {
        tool: "polygon",
        points: [...polygonPoints, cursorPt],
        color: s.color,
        width: s.width,
        filled: s.fillShapes,
      };
      drawStroke(surface, previewStroke, {
        colorOverride: `${s.color}88`,
        preview: true,
      });
    }

    function closePolygon() {
      if (polygonPoints.length < 3) {
        resetPolygon();
        redrawBase(committed);
        return;
      }
      const s = readSettings();
      queueStroke({
        tool: "polygon",
        points: [...polygonPoints],
        color: s.color,
        width: s.width,
        filled: s.fillShapes,
      });
      resetPolygon();
    }

    // ----- curve helpers -----
    function resetCurve() {
      curvePhase = 0;
      curveStroke = null;
    }

    // ----- pointer handlers -----
    function onPointerDown(e: PointerEvent) {
      const s = readSettings();
      const tool = s.tool;
      const cat = getToolCategory(tool);
      const pt = pointFromEvent(e);

      // Polygon: multi-click accumulator
      if (cat === "multiclick") {
        if (polygonPoints.length > 0) {
          const first = polygonPoints[0];
          if (Math.hypot(pt.x - first.x, pt.y - first.y) < 8) {
            closePolygon();
            return;
          }
        }
        polygonPoints.push(pt);
        previewPolygon(pt);
        return;
      }

      // Curve: multi-phase
      if (cat === "multiphase") {
        if (curvePhase === 0) {
          board.setPointerCapture(e.pointerId);
          curveStroke = {
            tool: "curve",
            points: [pt],
            color: s.color,
            width: s.width,
          };
          currentStroke = curveStroke;
          return;
        }
        if (curvePhase === 1 && curveStroke) {
          board.setPointerCapture(e.pointerId);
          if (curveStroke.points.length < 3) curveStroke.points.push(pt);
          else curveStroke.points[2] = pt;
          currentStroke = curveStroke;
          return;
        }
        if (curvePhase === 2 && curveStroke) {
          board.setPointerCapture(e.pointerId);
          if (curveStroke.points.length < 4) curveStroke.points.push(pt);
          else curveStroke.points[3] = pt;
          currentStroke = curveStroke;
          return;
        }
        return;
      }

      // Single-click tools (fill, eyedropper)
      if (cat === "singleclick") {
        if (tool === "fill") {
          queueStroke({
            tool: "fill",
            points: [pt],
            color: s.color,
            width: 0,
          });
          return;
        }
        if (tool === "eyedropper") {
          redrawBase(committed);
          const hex = pickColorAt(pt);
          if (hex) callbacksRef.current.onPickColor(hex);
          return;
        }
        return;
      }

      // Text tool: signal App to show text overlay
      if (cat === "text") {
        callbacksRef.current.onTextStart(pt, s.width > 8 ? s.width : DEFAULT_FONT_SIZE);
        return;
      }

      // Magnifier: zoom
      if (cat === "viewport") {
        const idx = ZOOM_LEVELS.indexOf(zoomLevel as (typeof ZOOM_LEVELS)[number]);
        if (e.shiftKey || e.button === 2) {
          zoomLevel = ZOOM_LEVELS[Math.max(0, idx - 1)];
        } else {
          zoomLevel = ZOOM_LEVELS[(idx + 1) % ZOOM_LEVELS.length];
        }
        if (zoomLevel === 1) panOffset = { x: 0, y: 0 };
        else {
          panOffset = {
            x: pt.x - board.clientWidth / zoomLevel / 2,
            y: pt.y - board.clientHeight / zoomLevel / 2,
          };
        }
        callbacksRef.current.onZoomChange(zoomLevel);
        resizeCanvas();
        redrawBase(committed);
        return;
      }

      // Standard drag-based tools
      board.setPointerCapture(e.pointerId);
      currentStroke = {
        points: [pt],
        color: s.color,
        width: s.width,
        tool: s.tool,
        filled: s.fillShapes,
        cornerRadius: tool === "roundrect" ? DEFAULT_CORNER_RADIUS : undefined,
        sprayRadius: tool === "spray" ? DEFAULT_SPRAY_RADIUS : undefined,
      };

      if (tool === "spray") {
        sprayCenter = pt;
        startSpray();
      }
    }

    function onPointerMove(e: PointerEvent) {
      const s = readSettings();
      const toolName = s.tool;
      const cat = getToolCategory(toolName);

      // Polygon preview: always track cursor when polygon is active
      if (cat === "multiclick" && polygonPoints.length > 0) {
        previewPolygon(pointFromEvent(e));
        return;
      }

      // Curve preview during phase 1/2 drag
      if (cat === "multiphase" && curveStroke && currentStroke === curveStroke) {
        const pt = pointFromEvent(e);
        if (curvePhase === 0) {
          if (curveStroke.points.length === 1) curveStroke.points.push(pt);
          else curveStroke.points[1] = pt;
        } else if (curvePhase === 1) {
          if (curveStroke.points.length < 3) curveStroke.points.push(pt);
          else curveStroke.points[2] = pt;
        } else if (curvePhase === 2) {
          if (curveStroke.points.length < 4) curveStroke.points.push(pt);
          else curveStroke.points[3] = pt;
        }
        redrawBase(committed);
        drawStroke(surface, curveStroke, { colorOverride: `${curveStroke.color}cc`, preview: true });
        return;
      }

      if (!currentStroke) return;
      let nextPoint = pointFromEvent(e);
      const tool = toolOf(currentStroke);
      const currentCat = getToolCategory(tool);

      if (currentCat === "freeform") {
        if (tool === "spray") {
          sprayCenter = nextPoint;
          return;
        }
        currentStroke.points.push(nextPoint);
      } else if (currentCat === "twopoint") {
        if (tool === "line" && e.shiftKey) {
          nextPoint = snappedLinePoint(currentStroke.points[0], nextPoint);
        }
        if (currentStroke.points.length === 1) {
          currentStroke.points.push(nextPoint);
        } else {
          currentStroke.points[1] = nextPoint;
        }
      }

      redrawBase(committed);
      drawStroke(surface, currentStroke, {
        colorOverride: tool === "eraser" ? "#55555588" : `${currentStroke.color}cc`,
        preview: true,
      });
    }

    function finishStroke() {
      const s = readSettings();
      const cat = getToolCategory(s.tool);

      // Stop spray
      stopSpray();

      // Curve: advance phase on pointer up
      if (cat === "multiphase" && curveStroke) {
        currentStroke = null;
        if (curvePhase === 0 && curveStroke.points.length >= 2) {
          curvePhase = 1;
          redrawBase(committed);
          drawStroke(surface, curveStroke, { colorOverride: `${curveStroke.color}cc`, preview: true });
          return;
        }
        if (curvePhase === 1) {
          curvePhase = 2;
          redrawBase(committed);
          drawStroke(surface, curveStroke, { colorOverride: `${curveStroke.color}cc`, preview: true });
          return;
        }
        if (curvePhase === 2) {
          queueStroke(curveStroke);
          resetCurve();
          return;
        }
        resetCurve();
        return;
      }

      if (!currentStroke) return;

      const tool = toolOf(currentStroke);
      const currentCat = getToolCategory(tool);

      if (currentCat === "freeform" && currentStroke.points.length < 2 && tool !== "spray") {
        currentStroke = null;
        return;
      }
      if (currentCat === "twopoint" && currentStroke.points.length < 2) {
        currentStroke = null;
        return;
      }

      queueStroke(currentStroke);
      currentStroke = null;
    }

    function onPointerCancel() {
      stopSpray();
      currentStroke = null;
      resetCurve();
      resetPolygon();
      redrawBase(committed);
    }

    function onDblClick(e: MouseEvent) {
      const s = readSettings();
      if (getToolCategory(s.tool) === "multiclick" && polygonPoints.length >= 3) {
        closePolygon();
        e.preventDefault();
      }
    }

    function onContextMenu(e: MouseEvent) {
      if (readSettings().tool === "magnifier") e.preventDefault();
    }

    function onKeyDown(event: KeyboardEvent) {
      const s = readSettings();

      // Escape cancels active polygon/curve
      if (event.key === "Escape") {
        if (polygonPoints.length > 0) {
          resetPolygon();
          redrawBase(committed);
          return;
        }
        if (curveStroke) {
          resetCurve();
          currentStroke = null;
          redrawBase(committed);
          return;
        }
      }

      const isPrimary = event.ctrlKey || event.metaKey;
      if (!isPrimary) return;

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        sendCommand("undo");
        return;
      }
      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        sendCommand("redo");
      }
    }

    function onResize() {
      resizeCanvas();
      redrawBase(committed);
    }

    board.addEventListener("pointerdown", onPointerDown);
    board.addEventListener("pointermove", onPointerMove);
    board.addEventListener("pointerup", finishStroke);
    board.addEventListener("pointercancel", onPointerCancel);
    board.addEventListener("dblclick", onDblClick);
    board.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);

    (apiRef as { current: BoardApi | null }).current = {
      sendCommand,
      downloadCanvas,
      queueStroke,
      pickColorAt,
    };

    resizeCanvas();
    refreshUndoRedoUi();
    connect();

    return () => {
      stopSpray();
      board.removeEventListener("pointerdown", onPointerDown);
      board.removeEventListener("pointermove", onPointerMove);
      board.removeEventListener("pointerup", finishStroke);
      board.removeEventListener("pointercancel", onPointerCancel);
      board.removeEventListener("dblclick", onDblClick);
      board.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (ws) ws.close();
      (apiRef as { current: BoardApi | null }).current = null;
    };
  }, [canvas, settingsRef, apiRef]);
}
