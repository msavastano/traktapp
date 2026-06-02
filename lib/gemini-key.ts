// Bring-your-own-key storage for the user's Gemini API key.
//
// The key lives only in the browser's localStorage and is forwarded to our own
// API routes via the GEMINI_KEY_HEADER on each AI request. We never persist it
// server-side.

export const GEMINI_KEY_HEADER = "x-gemini-key";
export const GEMINI_KEY_STORAGE = "gemini_api_key";

/** Custom error code returned by AI routes when no key was supplied. */
export const MISSING_KEY_ERROR = "missing_api_key";

export function getStoredGeminiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const key = window.localStorage.getItem(GEMINI_KEY_STORAGE);
    return key && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredGeminiKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function clearStoredGeminiKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export function hasStoredGeminiKey(): boolean {
  return getStoredGeminiKey() !== null;
}
