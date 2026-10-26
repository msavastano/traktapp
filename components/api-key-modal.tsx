"use client";

import { useEffect, useRef, useState } from "react";
import {
  getStoredAiKey,
  setStoredAiKey,
  clearStoredAiKey,
} from "@/lib/ai-key";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a key is saved so callers can retry their request. */
  onSaved?: () => void;
}

const CONSOLE_KEYS_URL = "https://platform.claude.com/settings/keys";

export function ApiKeyModal({ open, onClose, onSaved }: Props) {
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
    const existing = getStoredAiKey();
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
    setStoredAiKey(trimmed);
    setHasExisting(true);
    onSaved?.();
    onClose();
  };

  const handleClear = () => {
    clearStoredAiKey();
    setValue("");
    setHasExisting(false);
  };

  return (
    <dialog ref={dialogRef} className="news-dialog">
      <div className="news-dialog-body">
        <div className="news-dialog-header">
          <div>
            <div className="news-dialog-eyebrow">AI features</div>
            <h3 className="news-dialog-title">Your Anthropic API key</h3>
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
          <p className="api-key-intro">
            AI recommendations and the &ldquo;Latest news&rdquo; search are powered by
            Anthropic&apos;s Claude Haiku 5.5 model. To use them, paste your own
            Anthropic API key below. The app sends it straight to Anthropic on your
            behalf, and usage is billed to your own Anthropic account.
          </p>

          <ol className="api-key-steps">
            <li>
              Open the{" "}
              <a href={CONSOLE_KEYS_URL} target="_blank" rel="noopener noreferrer">
                Claude Console
              </a>{" "}
              and sign in (or create an account).
            </li>
            <li>
              Add credits under <strong>Billing</strong> if you haven&apos;t already,
              then click <strong>Create key</strong>.
            </li>
            <li>Copy the key it generates and paste it here.</li>
          </ol>

          <div className="api-key-warning" role="note">
            <strong>Keep this key private.</strong> It can spend credits on your
            Anthropic account. We store it only in this browser&apos;s local storage
            on your device and send it directly to Anthropic with each AI request —
            we never save it on our servers. Anyone with the key could use your
            credits, so don&apos;t share it. Haiku 5.5 is inexpensive, but the
            &ldquo;Latest news&rdquo; search also uses Claude&apos;s web search tool,
            which is billed per search. You can delete the key here at any time, or
            revoke it in the Console.
          </div>

          <label className="api-key-label" htmlFor="api-key-input">
            Anthropic API key
          </label>
          <div className="api-key-input-row">
            <input
              id="api-key-input"
              className="api-key-input"
              type={reveal ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="api-key-reveal"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? "Hide key" : "Show key"}
            >
              {reveal ? "Hide" : "Show"}
            </button>
          </div>

          <div className="api-key-actions">
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
