import { useEffect, useRef } from "react";

export function ResetDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} data-testid="dialog-reset">
      <h2>Reset demo data?</h2>
      <p>This replaces every invoice status and the decision record in this browser with the original synthetic fixture. Other open tabs will pick up the reset.</p>
      <div className="btn-row end">
        <button className="btn btn-ghost" data-testid="button-cancel-reset" onClick={onCancel}>Cancel</button>
        <button className="btn btn-reject" data-testid="button-confirm-reset" onClick={onConfirm}>Reset to fixture</button>
      </div>
    </dialog>
  );
}
