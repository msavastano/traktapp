"use client";

import { useEffect, useRef, useState } from "react";

interface NewsSource {
  uri: string;
  title: string;
}

interface NewsResponse {
  summary?: string;
  sources?: NewsSource[];
  cached?: boolean;
  generatedAt?: number;
  error?: string;
  detail?: string;
}

interface Props {
  open: boolean;
  showTitle: string;
  showYear: number | null;
  onClose: () => void;
}

export function NewsModal({ open, showTitle, showYear, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<NewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
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

  const fetchNews = (force = false) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ title: showTitle });
    if (showYear) params.set("year", String(showYear));
    if (force) params.set("refresh", "1");
    fetch(`/api/news?${params.toString()}`)
      .then(async (res) => {
        const json: NewsResponse = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `Request failed (${res.status})`);
        }
        setData(json);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load news");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    fetchNews(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showTitle, showYear]);

  return (
    <dialog ref={dialogRef} className="news-dialog">
      <div className="news-dialog-body">
        <div className="news-dialog-header">
          <div>
            <div className="news-dialog-eyebrow">Latest news</div>
            <h3 className="news-dialog-title">
              {showTitle}
              {showYear && (
                <span className="news-dialog-year"> ({showYear})</span>
              )}
            </h3>
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
          {loading && (
            <div className="news-dialog-loading">
              <div className="loading-spinner" />
              <span>Searching the web…</span>
            </div>
          )}
          {error && !loading && (
            <div className="news-dialog-error">
              <p>{error}</p>
              <button
                type="button"
                className="confirm-dialog-btn confirm-dialog-confirm"
                onClick={() => fetchNews(true)}
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && data?.summary && (
            <>
              <div className="news-dialog-summary">
                {data.summary.split(/\n\n+/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
              {data.sources && data.sources.length > 0 && (
                <div className="news-dialog-sources">
                  <div className="news-dialog-sources-label">Sources</div>
                  <ul>
                    {data.sources.map((s) => (
                      <li key={s.uri}>
                        <a
                          href={s.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {s.title || s.uri}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="news-dialog-footer-meta">
                {data.cached ? "Cached" : "Fresh"}
                {data.generatedAt && (
                  <>
                    {" · "}
                    {new Date(data.generatedAt).toLocaleString()}
                  </>
                )}
                <button
                  type="button"
                  className="news-dialog-refresh"
                  onClick={() => fetchNews(true)}
                  disabled={loading}
                >
                  Refresh
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
