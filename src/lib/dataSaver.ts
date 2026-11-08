/**
 * dataSaver.ts
 *
 * Utilities for tracking Data Saver mode, localStorage persistence,
 * and session data savings estimates from throttled 3D assets and compressed images.
 */

export const DATA_SAVER_STORAGE_KEY = "worksphere_data_saver";
export const DATA_SAVER_SAVINGS_KEY = "worksphere_data_saver_saved_mb";
export const DATA_SAVER_CHANGE_EVENT = "worksphere:data-saver-change";

// Data savings estimation constants (in Megabytes)
export const SAVINGS_PER_COMPRESSED_IMAGE_MB = 1.4;
export const SAVINGS_PER_THROTTLED_3D_ASSET_MB = 8.5;
export const SAVINGS_PER_DISABLED_VIDEO_AVATAR_MB = 6.0;
export const DEFAULT_BASE_SESSION_SAVINGS_MB = 18.4;

/**
 * Reads Data Saver state from localStorage safely.
 */
export function getDataSaverState(): boolean {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }
  try {
    return window.localStorage.getItem(DATA_SAVER_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Persists Data Saver state to localStorage and broadcasts change events.
 */
export function setDataSaverState(enabled: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      DATA_SAVER_STORAGE_KEY,
      enabled ? "true" : "false",
    );
    window.dispatchEvent(
      new CustomEvent(DATA_SAVER_CHANGE_EVENT, { detail: { enabled } }),
    );
    window.dispatchEvent(new Event("storage"));
  } catch (err) {
    console.warn("[DataSaver] Failed saving to localStorage:", err);
  }
}

/**
 * Reads estimated MB conserved during the session.
 */
export function getEstimatedSavedMB(): number {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return DEFAULT_BASE_SESSION_SAVINGS_MB;
  }
  try {
    const raw =
      window.sessionStorage.getItem(DATA_SAVER_SAVINGS_KEY) ??
      window.localStorage.getItem(DATA_SAVER_SAVINGS_KEY);
    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed >= 0) {
        return Number(parsed.toFixed(1));
      }
    }
    return DEFAULT_BASE_SESSION_SAVINGS_MB;
  } catch {
    return DEFAULT_BASE_SESSION_SAVINGS_MB;
  }
}

/**
 * Persists estimated data savings to sessionStorage & localStorage.
 */
export function setEstimatedSavedMB(mb: number): void {
  if (typeof window === "undefined") return;
  const value = mb.toFixed(1);
  try {
    window.sessionStorage?.setItem(DATA_SAVER_SAVINGS_KEY, value);
    window.localStorage?.setItem(DATA_SAVER_SAVINGS_KEY, value);
    window.dispatchEvent(
      new CustomEvent(DATA_SAVER_CHANGE_EVENT, { detail: { savedMB: mb } }),
    );
  } catch (err) {
    console.warn("[DataSaver] Failed updating saved MB:", err);
  }
}

/**
 * Increments accumulated data savings by a given delta in MB.
 */
export function recordDataSaved(deltaMB: number): void {
  if (deltaMB <= 0) return;
  const current = getEstimatedSavedMB();
  setEstimatedSavedMB(Number((current + deltaMB).toFixed(1)));
}
