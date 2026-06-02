"use client";

import { useEffect, useRef, useState } from "react";
import {
  getStoredGeminiKey,
  setStoredGeminiKey,
  clearStoredGeminiKey,
} from "@/lib/gemini-key";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a key is saved so callers can retry their request. */
  onSaved?: () => void;
}

const AI_STUDIO_URL = "https://aistudio.google.com/app/apikey";

export function GeminiKeyModal({ open, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Load any existing key when the modal opens.
  useEffect(() => {
    if (!open) return;
    const existing = getStoredGeminiKey();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(existing ?? "");
    setHasExisting(existing !== null);
    setReveal(false);
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const handleBackdrop = (e: MouseEvent) => {
      if (e.target === el) onClose();
    };
    el.addEventListener("cancel", handleCancel);
    el.addEventListener("click", handleBackdrop);
    return () => {
      el.removeEventListener("cancel", handleCancel);
      el.removeEventListener("click", handleBackdrop);
    };
  }, [onClose]);

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setStoredGeminiKey(trimmed);
    setHasExisting(true);
    onSaved?.();
    onClose();
  };

  const handleClear = () => {
    clearStoredGeminiKey();
    setValue("");
    setHasExisting(false);
  };

  return (
    <dialog ref={dialogRef} className="news-dialog">
      <div className="news-dialog-body">
        <div className="news-dialog-header">
          <div>
            <div className="news-dialog-eyebrow">AI features</div>
            <h3 className="news-dialog-title">Your Gemini API key</h3>
          </div>
          <button
            type="button"
            className="news-dialog-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="news-dialog-content">
          <p className="gemini-key-intro">
            AI recommendations and the &ldquo;Latest news&rdquo; search are powered by
            Google&apos;s Gemini models. To use them, paste your own free Gemini API
            key below. The app sends it straight to Google on your behalf — it is
            never billed to or shared with anyone else.
          </p>

          <ol className="gemini-key-steps">
            <li>
              Open{" "}
              <a href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer">
                Google AI Studio
              </a>{" "}
              and sign in with your Google account.
            </li>
            <li>
              Click <strong>Create API key</strong> (you may need to pick or create a
              Google Cloud project — the default is fine).
            </li>
            <li>Copy the key it generates and paste it here.</li>
          </ol>

          <div className="gemini-key-warning" role="note">
            <strong>Keep this key private.</strong> It grants access to your Google
            AI Studio quota. We store it only in this browser&apos;s local storage on
            your device and send it directly to Google with each AI request — we
            never save it on our servers. Anyone with the key could use your quota,
            so don&apos;t share it. The free tier has usage limits; heavy use may
            require billing on your Google account. You can delete the key here at
            any time, or revoke it in AI Studio.
          </div>

          <label className="gemini-key-label" htmlFor="gemini-key-input">
            Gemini API key
          </label>
          <div className="gemini-key-input-row">
            <input
              id="gemini-key-input"
              className="gemini-key-input"
              type={reveal ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="AIza…"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="gemini-key-reveal"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? "Hide key" : "Show key"}
            >
              {reveal ? "Hide" : "Show"}
            </button>
          </div>

          <div className="gemini-key-actions">
            <button
              type="button"
              className="confirm-dialog-btn confirm-dialog-confirm"
              onClick={handleSave}
              disabled={!value.trim()}
            >
              Save key
            </button>
            {hasExisting && (
              <button
                type="button"
                className="confirm-dialog-btn confirm-dialog-cancel"
                onClick={handleClear}
              >
                Remove key
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
