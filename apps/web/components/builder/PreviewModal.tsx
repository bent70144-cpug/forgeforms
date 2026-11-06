'use client';

// STUB — replaced by the B6 preview milestone (builder spec §8.4).
// Contract: controlled modal over the real conversational renderer.
export function PreviewModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="ff-preview-modal" data-testid="preview-modal-stub" role="dialog" aria-label="Preview">
      <button type="button" onClick={onClose}>Close preview</button>
      <p style={{ color: "#64748b", padding: 16 }}>Preview placeholder</p>
    </div>
  );
}
