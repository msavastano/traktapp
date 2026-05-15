"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

interface Props {
  showTitle: string;
  seasonNumber: number | null;
  busy: boolean;
  onMarkSeason: () => void;
  onMarkShow: () => void;
  onSkipEpisode?: () => void;
}

type Pending = null | { kind: "season" } | { kind: "show" };

export function WatchedMenu({
  showTitle,
  seasonNumber,
  busy,
  onMarkSeason,
  onMarkShow,
  onSkipEpisode,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const handleConfirm = () => {
    if (pending?.kind === "season") onMarkSeason();
    else if (pending?.kind === "show") onMarkShow();
    setPending(null);
  };

  const dialogConfig =
    pending?.kind === "show"
      ? {
          title: "Mark entire show watched?",
          message: `Every aired episode of "${showTitle}" will be marked watched on Trakt. This cannot be easily undone.`,
          confirmLabel: "Mark all watched",
        }
      : pending?.kind === "season" && seasonNumber !== null
        ? {
            title: `Mark season ${seasonNumber} watched?`,
            message: `All aired episodes of "${showTitle}" season ${seasonNumber} will be marked watched on Trakt.`,
            confirmLabel: `Mark season ${seasonNumber} watched`,
          }
        : null;

  return (
    <div className="watched-menu" ref={ref}>
      <button
        type="button"
        className="watched-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <div className="watched-menu-dropdown" role="menu">
          {onSkipEpisode && (
            <button
              type="button"
              role="menuitem"
              className="watched-menu-item"
              onClick={() => {
                setOpen(false);
                onSkipEpisode();
              }}
            >
              Skip this episode
            </button>
          )}
          {seasonNumber !== null && (
            <button
              type="button"
              role="menuitem"
              className="watched-menu-item"
              onClick={() => {
                setOpen(false);
                setPending({ kind: "season" });
              }}
            >
              Mark season {seasonNumber} watched
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="watched-menu-item"
            onClick={() => {
              setOpen(false);
              setPending({ kind: "show" });
            }}
          >
            Mark entire show watched
          </button>
        </div>
      )}

      {dialogConfig && (
        <ConfirmDialog
          open={pending !== null}
          title={dialogConfig.title}
          message={dialogConfig.message}
          confirmLabel={dialogConfig.confirmLabel}
          destructive
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
