import type { BoardSettings } from "./types";

/** Initial drawing settings (palette default + engine fallback). */
export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  color: "#000000",
  width: 3,
  tool: "pen",
  fillShapes: false,
};

export const BRUSH_SIZE_MIN = 1;
export const BRUSH_SIZE_MAX = 40;

export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_SPRAY_RADIUS = 20;
export const DEFAULT_CORNER_RADIUS = 10;
export const ZOOM_LEVELS = [1, 2, 4, 8] as const;

/** Classic-style palette: 28 swatches, 14×2 grid. */
export const PALETTE_COLORS: readonly string[] = [
  "#000000",
  "#808080",
  "#800000",
  "#808000",
  "#008000",
  "#008080",
  "#000080",
  "#800080",
  "#808040",
  "#004040",
  "#c0c0c0",
  "#ffffff",
  "#ff0000",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#ff00ff",
  "#400040",
  "#804000",
  "#004080",
  "#408080",
  "#800040",
  "#ff8080",
  "#ffff80",
  "#80ff80",
  "#80ffff",
];

export const README_PARAGRAPHS: readonly string[] = [
  "Distributed Real-Time Drawing Board (Mini-RAFT)",
  "This collaborative drawing board sends each stroke over WebSocket to the cluster gateway. Strokes are replicated with a simplified Mini-RAFT implementation so all clients converge on the same committed history.",
  "Tips:\n• Use the tools on the left and the color palette below.\n• Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo.\n• Hold Shift while drawing a line to snap to 45° angles.\n• File → Save as Image exports the current canvas as PNG.",
  "For full setup, architecture, and run instructions, see the project README in the repository.",
];
