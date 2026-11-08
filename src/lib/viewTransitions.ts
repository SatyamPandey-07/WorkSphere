/**
 * Helper utilities for View Transitions API between venue lists and details.
 */

/**
 * Generates a valid CSS custom-ident transition name for a venue's cover image.
 * Strips special characters to ensure browser compatibility.
 */
export function getVenueCoverTransitionName(
  venueId?: string | null,
): string | undefined {
  if (!venueId) return undefined;
  const sanitized = venueId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `venue-cover-${sanitized}`;
}

/**
 * Runs a navigation callback within a View Transition if supported by the browser,
 * falling back gracefully to standard navigation otherwise.
 */
export function navigateWithViewTransition(navigateFn: () => void): void {
  if (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    typeof (document as any).startViewTransition === "function"
  ) {
    (document as any).startViewTransition(() => {
      navigateFn();
    });
  } else {
    navigateFn();
  }
}
