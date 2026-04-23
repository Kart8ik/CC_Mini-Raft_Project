import type { BoardTool } from "../types";

type ToolDef = {
  icon: string;
  alt: string;
  tool?: BoardTool;
};

const TOOL_ITEMS: ToolDef[] = [
  { icon: "icons/eraserTool.png", alt: "Eraser", tool: "eraser" },
  { icon: "icons/paintBucketTool.png", alt: "Fill", tool: "fill" },
  { icon: "icons/eyeDropperTool.png", alt: "Color picker", tool: "eyedropper" },
  { icon: "icons/magnifierTool.png", alt: "Magnifier", tool: "magnifier" },
  { icon: "icons/pencilTool.png", alt: "Pencil", tool: "pen" },
  { icon: "icons/brushTool.png", alt: "Brush", tool: "brush" },
  { icon: "icons/airBrushTool.png", alt: "Airbrush", tool: "spray" },
  { icon: "icons/textTool.png", alt: "Text", tool: "text" },
  { icon: "icons/lineTool.png", alt: "Line", tool: "line" },
  { icon: "icons/curveTool.png", alt: "Curve", tool: "curve" },
  { icon: "icons/rectangleTool.png", alt: "Rectangle", tool: "rect" },
  { icon: "icons/polygonTool.png", alt: "Polygon", tool: "polygon" },
  { icon: "icons/ellipseTool.png", alt: "Ellipse", tool: "circle" },
  { icon: "icons/roundedRectangleTool.png", alt: "Rounded rectangle", tool: "roundrect" },
];

type ToolbarProps = {
  activeTool: BoardTool;
  onSelectTool: (tool: BoardTool) => void;
};

export function Toolbar({ activeTool, onSelectTool }: ToolbarProps) {
  return (
    <aside className="board-tool-column" aria-label="Tools">
      <div className="board-tool-grid">
        {TOOL_ITEMS.map((item) => {
          const hasTool = item.tool !== undefined;
          const isActive = hasTool && item.tool === activeTool;
          return (
            <button
              key={item.alt}
              type="button"
              className={`board-tool-btn${isActive ? " board-tool-active" : ""}`}
              title={item.alt}
              aria-pressed={hasTool ? isActive : undefined}
              aria-disabled={!hasTool}
              tabIndex={hasTool ? undefined : -1}
              {...(hasTool ? { "data-tool": item.tool } : {})}
              onClick={hasTool ? () => onSelectTool(item.tool!) : undefined}
            >
              <img src={item.icon} alt="" width={24} height={24} decoding="async" />
            </button>
          );
        })}
      </div>
      <div className="board-tool-secondary win-sunken" aria-hidden="true" />
    </aside>
  );
}
