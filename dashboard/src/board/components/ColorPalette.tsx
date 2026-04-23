import { PALETTE_COLORS } from "../constants";

type ColorPaletteProps = {
  selectedColor: string;
  onSelectColor: (hex: string) => void;
};

export function ColorPalette({ selectedColor, onSelectColor }: ColorPaletteProps) {
  const selectedLower = selectedColor.toLowerCase();

  return (
    <div className="board-palette-row">
      <div className="board-color-preview win-sunken" aria-hidden="true">
        <div className="board-color-preview-fg" style={{ background: selectedColor }} />
        <div className="board-color-preview-bg" />
      </div>
      <div className="board-palette-grid" role="listbox" aria-label="Color palette">
        {PALETTE_COLORS.map((hex) => {
          const selected = hex.toLowerCase() === selectedLower;
          return (
            <button
              key={hex}
              type="button"
              role="option"
              aria-selected={selected}
              className={`board-swatch${selected ? " board-swatch-selected" : ""}`}
              style={{ backgroundColor: hex }}
              title={hex}
              onClick={() => onSelectColor(hex)}
            />
          );
        })}
      </div>
    </div>
  );
}
