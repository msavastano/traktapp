"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserProfile } from "./user-profile";
import { ThemeToggle } from "./theme-toggle";
import { GeminiKeyModal } from "./gemini-key-modal";
import Link from "next/link";

export function Navbar() {
  const { isAuthenticated, isLoading } = useAuth();
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  return (
    <nav className="navbar" id="navbar">
      <Link href={isAuthenticated ? "/dashboard" : "/"} className="navbar-brand">
        <span className="navbar-brand-icon">📺</span>
        TraktApp
      </Link>

      <div className="navbar-actions">
        {!isLoading && isAuthenticated && (
          <button
            type="button"
            className="theme-toggle-btn"
            aria-label="Manage Gemini API key"
            title="Gemini API key"
            onClick={() => setKeyModalOpen(true)}
          >
            🔑
          </button>
        )}
        <ThemeToggle />
        {!isLoading && isAuthenticated && <UserProfile />}
      </div>

      <GeminiKeyModal open={keyModalOpen} onClose={() => setKeyModalOpen(false)} />
    </nav>
  );
}
