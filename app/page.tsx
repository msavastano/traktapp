"use client";

import { LoginButton } from "@/components/login-button";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";

function HomeContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p className="loading-text">Loading…</p>
      </div>
    );
  }

  return (
    <main className="hero" id="home-page">
      {error && (
        <div className="error-toast" role="alert">
          {error === "no_code" && "Authorization was cancelled."}
          {error === "invalid_state" && "Security check failed. Please try again."}
          {error === "token_exchange_failed" && "Login failed. Please try again."}
        </div>
      )}

      <div className="hero-content">
        <div className="hero-icon">📺</div>

        <h1 className="hero-title">
          Track Your{" "}
          <span className="hero-title-accent">TV Shows</span>
        </h1>

        <p className="hero-subtitle">
          Keep a living record of everything you watch. Discover trending shows,
          manage your watchlist, and never lose track of where you left off.
        </p>

        <LoginButton />

        <div className="features">
          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <div className="feature-title">Watch History</div>
            <div className="feature-desc">
              Automatically log episodes as you watch them
            </div>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔥</div>
            <div className="feature-title">Trending</div>
            <div className="feature-desc">
              Discover what everyone is watching right now
            </div>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📋</div>
            <div className="feature-title">Watchlist</div>
            <div className="feature-desc">
              Queue up shows you want to watch next
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p className="loading-text">Loading…</p>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
