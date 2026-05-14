"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

interface Props {
  showTitle: string;
  episodeLabel: string;
  episodeSeason: number | null;
  busy: boolean;
  onUnwatchEpisode: () => void;
  onUnwatchSeason: () => void;
}

type Pending = null | { kind: "episode" } | { kind: "season" };

export function UnwatchMenu({
  showTitle,
  episodeLabel,
  episodeSeason,
  busy,
  onUnwatchEpisode,
  onUnwatchSeason,
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
    if (pending?.kind === "episode") onUnwatchEpisode();
    else if (pending?.kind === "season") onUnwatchSeason();
    setPending(null);
  };

  const dialogConfig =
    pending?.kind === "episode"
      ? {
          title: "Unwatch this episode?",
          message: `${episodeLabel} of "${showTitle}" will be removed from your Trakt history.`,
          confirmLabel: "Unwatch episode",
        }
      : pending?.kind === "season" && episodeSeason !== null
        ? {
            title: `Unwatch season ${episodeSeason}?`,
            message: `All watched episodes of "${showTitle}" season ${episodeSeason} will be removed from your Trakt history.`,
            confirmLabel: `Unwatch season ${episodeSeason}`,
          }
        : null;

  return (
    <span className="unwatch-menu" ref={ref}>
      <button
        type="button"
        className="unwatch-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Unwatch options"
        title="Unwatch options"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        ↶
      </button>
      {open && (
        <div className="unwatch-menu-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            className="unwatch-menu-item"
            onClick={() => {
              setOpen(false);
              setPending({ kind: "episode" });
            }}
          >
            Unwatch last episode
          </button>
          {episodeSeason !== null && (
            <button
              type="button"
              role="menuitem"
              className="unwatch-menu-item"
              onClick={() => {
                setOpen(false);
                setPending({ kind: "season" });
              }}
            >
              Unwatch season {episodeSeason}
            </button>
          )}
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
    </span>
  );
}
