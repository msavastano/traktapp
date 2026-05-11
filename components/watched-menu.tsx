"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  showTitle: string;
  seasonNumber: number | null;
  busy: boolean;
  onMarkSeason: () => void;
  onMarkShow: () => void;
}

export function WatchedMenu({
  showTitle,
  seasonNumber,
  busy,
  onMarkSeason,
  onMarkShow,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const handleShow = () => {
    setOpen(false);
    if (
      window.confirm(
        `Mark every aired episode of "${showTitle}" as watched? This cannot be easily undone.`
      )
    ) {
      onMarkShow();
    }
  };

  const handleSeason = () => {
    setOpen(false);
    onMarkSeason();
  };

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
          {seasonNumber !== null && (
            <button
              type="button"
              role="menuitem"
              className="watched-menu-item"
              onClick={handleSeason}
            >
              Mark season {seasonNumber} watched
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="watched-menu-item"
            onClick={handleShow}
          >
            Mark entire show watched
          </button>
        </div>
      )}
    </div>
  );
}
