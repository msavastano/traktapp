"use client";

import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Native <dialog> emits "cancel" on ESC and on backdrop click (when
  // closeable). Route both to onCancel.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    const handleBackdrop = (e: MouseEvent) => {
      if (e.target === el) onCancel();
    };
    el.addEventListener("cancel", handleCancel);
    el.addEventListener("click", handleBackdrop);
    return () => {
      el.removeEventListener("cancel", handleCancel);
      el.removeEventListener("click", handleBackdrop);
    };
  }, [onCancel]);

  return (
    <dialog ref={dialogRef} className="confirm-dialog">
      <div className="confirm-dialog-body">
        <h3 className="confirm-dialog-title">{title}</h3>
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-cancel"
            onClick={onCancel}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              "confirm-dialog-btn " +
              (destructive ? "confirm-dialog-destructive" : "confirm-dialog-confirm")
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
