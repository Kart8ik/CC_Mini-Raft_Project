import { useCallback, useRef, useState } from "react";
import { ColorPalette } from "./components/ColorPalette";
import { MenuBar } from "./components/MenuBar";
import { ReadmeModal } from "./components/ReadmeModal";
import { StatusBar } from "./components/StatusBar";
import { TextOverlay } from "./components/TextOverlay";
import { Toolbar } from "./components/Toolbar";
import { BRUSH_SIZE_MAX, BRUSH_SIZE_MIN, DEFAULT_BOARD_SETTINGS } from "./constants";
import type { BoardApi, BoardSettings, BoardTool, Point } from "./types";
import { useBoardEngine } from "./useBoardEngine";

export function App() {
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const settingsRef = useRef<BoardSettings>({ ...DEFAULT_BOARD_SETTINGS });
  const apiRef = useRef<BoardApi | null>(null);

  const [activeTool, setActiveTool] = useState<BoardTool>(DEFAULT_BOARD_SETTINGS.tool);
  const [color, setColor] = useState(DEFAULT_BOARD_SETTINGS.color);
  const [brushWidth, setBrushWidth] = useState(DEFAULT_BOARD_SETTINGS.width);
  const [fillShapes, setFillShapes] = useState(DEFAULT_BOARD_SETTINGS.fillShapes);
  const [connectionText, setConnectionText] = useState("Connecting...");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [readmeOpen, setReadmeOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Text tool state
  const [textInput, setTextInput] = useState<{ position: Point; fontSize: number } | null>(null);
  const textInputRef = useRef(textInput);
  textInputRef.current = textInput;

  // Track previous tool for eyedropper revert
  const previousToolRef = useRef<BoardTool>("pen");

  settingsRef.current = {
    color,
    width: brushWidth,
    tool: activeTool,
    fillShapes,
  };

  const handleSelectTool = useCallback((tool: BoardTool) => {
    if (tool === "eyedropper") {
      previousToolRef.current = activeTool === "eyedropper" ? "pen" : activeTool;
    }
    setActiveTool(tool);
  }, [activeTool]);

  useBoardEngine(canvasEl, settingsRef, apiRef, {
    onConnectionStatus: setConnectionText,
    onUndoRedoState: (u, r) => {
      setCanUndo(u);
      setCanRedo(r);
    },
    onPickColor: (hex) => {
      setColor(hex);
      setActiveTool(previousToolRef.current);
    },
    onTextStart: (position, fontSize) => {
      if (textInputRef.current) {
        setTextInput(null);
      }
      requestAnimationFrame(() => setTextInput({ position, fontSize }));
    },
    onZoomChange: setZoomLevel,
  });

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    setCanvasEl(node);
  }, []);

  const withApi = useCallback((fn: (api: BoardApi) => void) => {
    const api = apiRef.current;
    if (api) fn(api);
  }, []);

  function commitText(text: string) {
    if (!textInput) return;
    withApi((api) => {
      api.queueStroke({
        tool: "text",
        points: [textInput.position],
        color,
        width: brushWidth,
        text,
        fontSize: textInput.fontSize,
      });
    });
    setTextInput(null);
  }

  return (
    <div className="board-app" data-tool={activeTool}>
      <MenuBar
        onFileNew={() => withApi((api) => api.sendCommand("clear"))}
        onFileSaveImage={() => withApi((api) => api.downloadCanvas())}
        onEditUndo={() => withApi((api) => api.sendCommand("undo"))}
        onEditRedo={() => withApi((api) => api.sendCommand("redo"))}
        onEditToggleFill={() => setFillShapes((v) => !v)}
        fillShapes={fillShapes}
        canUndo={canUndo}
        canRedo={canRedo}
        onAboutReadme={() => setReadmeOpen(true)}
      />

      <div className="board-workspace">
        <Toolbar activeTool={activeTool} onSelectTool={handleSelectTool} />
        <div className="board-canvas-wrap">
          <div className="board-canvas-inner win-sunken">
            <canvas id="board" ref={canvasRef} />
            {textInput && (
              <TextOverlay
                position={textInput.position}
                fontSize={textInput.fontSize}
                color={color}
                onCommit={commitText}
                onCancel={() => setTextInput(null)}
              />
            )}
          </div>
        </div>
      </div>

      <div className="board-bottom-bar">
        <ColorPalette selectedColor={color} onSelectColor={setColor} />
        <div className="board-size-group">
          <label htmlFor="sizePicker">Size</label>
          <input
            id="sizePicker"
            type="range"
            min={BRUSH_SIZE_MIN}
            max={BRUSH_SIZE_MAX}
            value={brushWidth}
            onChange={(e) => setBrushWidth(Number(e.target.value))}
          />
          <span id="sizeValue">{brushWidth}</span>
        </div>
      </div>

      <StatusBar connectionText={connectionText} zoomLevel={zoomLevel} />

      <ReadmeModal open={readmeOpen} onClose={() => setReadmeOpen(false)} />
    </div>
  );
}
