type StatusBarProps = {
  connectionText: string;
  zoomLevel?: number;
};

export function StatusBar({ connectionText, zoomLevel }: StatusBarProps) {
  return (
    <footer className="board-status-bar" role="contentinfo">
      <div className="board-status-seg">For Info, click About → Readme</div>
      {zoomLevel !== undefined && zoomLevel > 1 && (
        <div className="board-status-seg">{zoomLevel}x</div>
      )}
      <div className="board-status-seg-right">{connectionText}</div>
    </footer>
  );
}
