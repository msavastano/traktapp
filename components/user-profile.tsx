"use client";

import { useAuth } from "@/lib/auth-context";
import { useState, useRef, useEffect } from "react";

export function UserProfile() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  const initial = (user.name || user.username || "?").charAt(0).toUpperCase();

  return (
    <div className="user-chip" ref={ref}>
      <button
        id="user-profile-toggle"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.username}
            className="user-avatar"
          />
        ) : (
          <span className="user-avatar-placeholder">{initial}</span>
        )}
        <span className="user-name">{user.name || user.username}</span>
      </button>

      <div className={`user-dropdown ${open ? "open" : ""}`}>
        <button
          id="logout-button"
          className="user-dropdown-item danger"
          onClick={logout}
        >
          ↩ Sign out
        </button>
      </div>
    </div>
  );
}
