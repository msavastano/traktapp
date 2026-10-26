"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserProfile } from "./user-profile";
import { ThemeToggle } from "./theme-toggle";
import { ApiKeyModal } from "./api-key-modal";
import Link from "next/link";

export function Navbar() {
  const { isAuthenticated, isLoading } = useAuth();
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  return (
    <nav className="navbar" id="navbar">
      <Link href={isAuthenticated ? "/dashboard" : "/"} className="navbar-brand">
        <span className="navbar-brand-icon">📺</span>
        SimklApp
      </Link>

      <div className="navbar-actions">
        {!isLoading && isAuthenticated && (
          <button
            type="button"
            className="theme-toggle-btn"
            aria-label="Manage Anthropic API key"
            title="Anthropic API key"
            onClick={() => setKeyModalOpen(true)}
          >
            🔑
          </button>
        )}
        <ThemeToggle />
        {!isLoading && isAuthenticated && <UserProfile />}
      </div>

      <ApiKeyModal open={keyModalOpen} onClose={() => setKeyModalOpen(false)} />
    </nav>
  );
}
