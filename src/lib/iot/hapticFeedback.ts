/**
 * Haptic confirmation for smart desk NFC and digital badge taps.
 *
 * Wraps the Web Vibration API (`navigator.vibrate`) with fixed patterns for
 * pending, success, and error taps. Every function is safe to call on
 * desktop browsers and iOS Safari, where `navigator.vibrate` is undefined,
 * and never throws.
 */

/** Vibration patterns in milliseconds (vibrate, pause, vibrate, ...). */
export const NFC_TAP_HAPTIC_PATTERNS = Object.freeze({
  /** Badge read and desk check-in confirmed. */
  SUCCESS_TAP: Object.freeze([50, 30, 50]),
  /** Badge rejected, desk unavailable, or check-in failed. */
  ERROR_TAP: Object.freeze([100, 50, 100, 50, 100]),
  /** Tap detected, waiting for the check-in result. */
  PENDING_TAP: Object.freeze([30]),
}) as {
  readonly SUCCESS_TAP: readonly number[];
  readonly ERROR_TAP: readonly number[];
  readonly PENDING_TAP: readonly number[];
};

export type NfcTapHapticKind = keyof typeof NFC_TAP_HAPTIC_PATTERNS;

/** True when the current environment exposes `navigator.vibrate`. */
export function isVibrationSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator !== null &&
    typeof navigator.vibrate === "function"
  );
}

/**
 * Plays the vibration pattern for a tap result.
 *
 * Returns `true` only when the browser accepted the vibration request.
 * Returns `false` on unsupported environments, unknown kinds, or when the
 * browser blocks the call (for example before a user gesture), and never
 * throws.
 */
export function triggerNfcTapHaptic(kind: NfcTapHapticKind): boolean {
  if (!isVibrationSupported()) return false;

  const pattern = Object.prototype.hasOwnProperty.call(
    NFC_TAP_HAPTIC_PATTERNS,
    kind,
  )
    ? NFC_TAP_HAPTIC_PATTERNS[kind]
    : undefined;
  if (!pattern) return false;

  try {
    // navigator.vibrate rejects frozen arrays in some engines, so pass a copy.
    return navigator.vibrate([...pattern]) === true;
  } catch {
    return false;
  }
}

export const triggerSuccessTap = (): boolean => triggerNfcTapHaptic("SUCCESS_TAP");
export const triggerErrorTap = (): boolean => triggerNfcTapHaptic("ERROR_TAP");
export const triggerPendingTap = (): boolean => triggerNfcTapHaptic("PENDING_TAP");

/** Minimal callback surface of the NFC desk check-in controller. */
export interface NfcHapticTarget {
  onDeskCheckin?: (deskId: string, userId: string, timestamp: number) => void;
  onDeskCheckout?: (deskId: string, userId: string, durationMs: number) => void;
  onTapRejected?: (deskId: string, reason: string) => void;
}

/**
 * Connects haptic feedback to an NFC desk check-in controller.
 *
 * Check-in and check-out play SUCCESS_TAP, and any rejected tap plays
 * ERROR_TAP. Callbacks that were already set on the controller keep
 * running, and a haptic failure never blocks them. Returns a function that
 * restores the previous callbacks.
 */
export function bindNfcDeskHaptics(target: NfcHapticTarget): () => void {
  const previous = {
    onDeskCheckin: target.onDeskCheckin,
    onDeskCheckout: target.onDeskCheckout,
    onTapRejected: target.onTapRejected,
  };

  target.onDeskCheckin = (deskId, userId, timestamp) => {
    triggerSuccessTap();
    previous.onDeskCheckin?.(deskId, userId, timestamp);
  };
  target.onDeskCheckout = (deskId, userId, durationMs) => {
    triggerSuccessTap();
    previous.onDeskCheckout?.(deskId, userId, durationMs);
  };
  target.onTapRejected = (deskId, reason) => {
    triggerErrorTap();
    previous.onTapRejected?.(deskId, reason);
  };

  return () => {
    target.onDeskCheckin = previous.onDeskCheckin;
    target.onDeskCheckout = previous.onDeskCheckout;
    target.onTapRejected = previous.onTapRejected;
  };
}
