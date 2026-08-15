"use client";

import { useAuth } from "@/lib/auth-context";
import { useState } from "react";

export function LoginButton() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    setLoading(true);
    login();
  };

  return (
    <button
      id="login-button"
      className={`login-button ${loading ? "loading" : ""}`}
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? (
        <span className="spinner" />
      ) : (
        <span className="login-button-icon">▶</span>
      )}
      {loading ? "Redirecting…" : "Sign in with Simkl"}
    </button>
  );
}
