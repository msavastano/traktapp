"use client";

import { useAuth } from "@/lib/auth-context";
import { UserProfile } from "./user-profile";
import { ThemeToggle } from "./theme-toggle";
import Link from "next/link";

export function Navbar() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <nav className="navbar" id="navbar">
      <Link href={isAuthenticated ? "/dashboard" : "/"} className="navbar-brand">
        <span className="navbar-brand-icon">📺</span>
        TraktApp
      </Link>

      <div className="navbar-actions">
        <ThemeToggle />
        {!isLoading && isAuthenticated && <UserProfile />}
      </div>
    </nav>
  );
}
