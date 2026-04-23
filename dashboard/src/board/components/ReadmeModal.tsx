import { README_PARAGRAPHS } from "../constants";

type ReadmeModalProps = {
  open: boolean;
  onClose: () => void;
};

export function ReadmeModal({ open, onClose }: ReadmeModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="board-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="readme-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="board-modal win-raised">
        <h2 id="readme-modal-title">Readme</h2>
        {README_PARAGRAPHS.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
        <div className="board-modal-actions">
          <button type="button" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
