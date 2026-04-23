import { useEffect, useRef } from "react";
import type { Point } from "../types";

type TextOverlayProps = {
  position: Point;
  fontSize: number;
  color: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
};

export function TextOverlay({ position, fontSize, color, onCommit, onCancel }: TextOverlayProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    // Delay focus until after the pointer event sequence that triggered
    // this overlay completes — browsers defer focus during active pointers.
    const id = requestAnimationFrame(() => {
      ref.current?.focus();
      readyRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const value = ref.current?.value.trim();
      if (value) onCommit(value);
      else onCancel();
    }
    if (e.key === "Escape") {
      onCancel();
    }
  }

  function handleBlur() {
    if (!readyRef.current) return;
    const value = ref.current?.value.trim();
    if (value) onCommit(value);
    else onCancel();
  }

  return (
    <textarea
      ref={ref}
      className="board-text-overlay"
      style={{
        left: position.x,
        top: position.y,
        fontSize: `${fontSize}px`,
        color,
        lineHeight: `${fontSize * 1.2}px`,
      }}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPointerDown={(e) => e.stopPropagation()}
      rows={1}
    />
  );
}
