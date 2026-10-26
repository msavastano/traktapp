// Bring-your-own-key storage for the user's Anthropic API key.
//
// The key lives only in the browser's localStorage and is forwarded to our own
// API routes via the AI_KEY_HEADER on each AI request. We never persist it
// server-side.

export const AI_KEY_HEADER = "x-anthropic-key";
export const AI_KEY_STORAGE = "anthropic_api_key";

/** Custom error code returned by AI routes when no key was supplied. */
export const MISSING_KEY_ERROR = "missing_api_key";

export function getStoredAiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const key = window.localStorage.getItem(AI_KEY_STORAGE);
    return key && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredAiKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_KEY_STORAGE, key.trim());
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function clearStoredAiKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AI_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export function hasStoredAiKey(): boolean {
  return getStoredAiKey() !== null;
}
