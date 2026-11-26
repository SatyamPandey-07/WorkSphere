/**
 * Session Configuration (src/lib/auth/sessionConfig.ts)
 *
 * Application-level session timeout and warning durations for Clerk-managed sessions.
 */

/** Inactivity duration before warning dialog appears (30 minutes) */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Countdown duration on warning dialog before auto-logout (60 seconds) */
export const WARNING_DURATION_MS = 60 * 1000;
