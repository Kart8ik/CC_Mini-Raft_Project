import type { RefCallback } from "react";

type CanvasAreaProps = {
  canvasRef: RefCallback<HTMLCanvasElement | null>;
};

export function CanvasArea({ canvasRef }: CanvasAreaProps) {
  return (
    <div className="board-canvas-wrap">
      <div className="board-canvas-inner win-sunken">
        <canvas id="board" ref={canvasRef} />
      </div>
    </div>
  );
}
