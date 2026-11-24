import {
  NFC_TAP_HAPTIC_PATTERNS,
  bindNfcDeskHaptics,
  isVibrationSupported,
  triggerErrorTap,
  triggerNfcTapHaptic,
  triggerPendingTap,
  triggerSuccessTap,
  type NfcHapticTarget,
  type NfcTapHapticKind,
} from "@/lib/iot/hapticFeedback";

function setVibrate(value: unknown) {
  Object.defineProperty(navigator, "vibrate", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("hapticFeedback", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "vibrate");

  afterEach(() => {
    if (original) {
      Object.defineProperty(navigator, "vibrate", original);
    } else {
      delete (navigator as unknown as Record<string, unknown>).vibrate;
    }
  });

  describe("patterns", () => {
    it("defines the documented vibration arrays", () => {
      expect([...NFC_TAP_HAPTIC_PATTERNS.SUCCESS_TAP]).toEqual([50, 30, 50]);
      expect([...NFC_TAP_HAPTIC_PATTERNS.ERROR_TAP]).toEqual([
        100, 50, 100, 50, 100,
      ]);
      expect([...NFC_TAP_HAPTIC_PATTERNS.PENDING_TAP]).toEqual([30]);
    });

    it("cannot be mutated at runtime", () => {
      expect(Object.isFrozen(NFC_TAP_HAPTIC_PATTERNS)).toBe(true);
      expect(Object.isFrozen(NFC_TAP_HAPTIC_PATTERNS.SUCCESS_TAP)).toBe(true);
      expect(() => {
        (NFC_TAP_HAPTIC_PATTERNS.SUCCESS_TAP as number[]).push(1);
      }).toThrow();
    });
  });

  describe("when navigator.vibrate is supported", () => {
    let vibrate: jest.Mock;

    beforeEach(() => {
      vibrate = jest.fn().mockReturnValue(true);
      setVibrate(vibrate);
    });

    it("reports support", () => {
      expect(isVibrationSupported()).toBe(true);
    });

    it.each([
      ["SUCCESS_TAP", [50, 30, 50]],
      ["ERROR_TAP", [100, 50, 100, 50, 100]],
      ["PENDING_TAP", [30]],
    ] as const)("%s vibrates with %j", (kind, expected) => {
      expect(triggerNfcTapHaptic(kind)).toBe(true);
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(vibrate).toHaveBeenCalledWith([...expected]);
    });

    it("passes a mutable copy, not the frozen constant", () => {
      triggerSuccessTap();
      const arg = vibrate.mock.calls[0][0] as number[];
      expect(arg).not.toBe(NFC_TAP_HAPTIC_PATTERNS.SUCCESS_TAP);
      expect(Object.isFrozen(arg)).toBe(false);
    });

    it("shortcut helpers use the matching patterns", () => {
      triggerSuccessTap();
      triggerErrorTap();
      triggerPendingTap();
      expect(vibrate.mock.calls.map((c) => c[0])).toEqual([
        [50, 30, 50],
        [100, 50, 100, 50, 100],
        [30],
      ]);
    });

    it("returns false when the browser declines the request", () => {
      vibrate.mockReturnValue(false);
      expect(triggerSuccessTap()).toBe(false);
    });

    it("returns false and does not call vibrate for an unknown kind", () => {
      expect(triggerNfcTapHaptic("NOPE" as NfcTapHapticKind)).toBe(false);
      expect(triggerNfcTapHaptic("toString" as NfcTapHapticKind)).toBe(false);
      expect(vibrate).not.toHaveBeenCalled();
    });

    it("swallows exceptions thrown by navigator.vibrate", () => {
      vibrate.mockImplementation(() => {
        throw new Error("blocked by permissions policy");
      });
      expect(() => triggerErrorTap()).not.toThrow();
      expect(triggerErrorTap()).toBe(false);
    });
  });

  describe("when navigator.vibrate is unsupported", () => {
    it("does not throw and returns false when undefined", () => {
      setVibrate(undefined);
      expect(isVibrationSupported()).toBe(false);
      expect(() => triggerSuccessTap()).not.toThrow();
      expect(triggerSuccessTap()).toBe(false);
      expect(triggerErrorTap()).toBe(false);
      expect(triggerPendingTap()).toBe(false);
    });

    it("treats a non function value as unsupported", () => {
      setVibrate("yes");
      expect(isVibrationSupported()).toBe(false);
      expect(triggerPendingTap()).toBe(false);
    });

    it("is safe when the vibrate property is missing entirely", () => {
      delete (navigator as unknown as Record<string, unknown>).vibrate;
      expect(isVibrationSupported()).toBe(false);
      expect(triggerSuccessTap()).toBe(false);
    });
  });

  describe("bindNfcDeskHaptics", () => {
    let vibrate: jest.Mock;

    beforeEach(() => {
      vibrate = jest.fn().mockReturnValue(true);
      setVibrate(vibrate);
    });

    it("vibrates success on check-in and check-out, error on rejection", () => {
      const target: NfcHapticTarget = {};
      bindNfcDeskHaptics(target);

      target.onDeskCheckin?.("d1", "u1", 1);
      target.onDeskCheckout?.("d1", "u1", 1000);
      target.onTapRejected?.("d1", "bad signature");

      expect(vibrate.mock.calls.map((c) => c[0])).toEqual([
        [50, 30, 50],
        [50, 30, 50],
        [100, 50, 100, 50, 100],
      ]);
    });

    it("keeps existing callbacks running", () => {
      const onDeskCheckin = jest.fn();
      const onDeskCheckout = jest.fn();
      const onTapRejected = jest.fn();
      const target: NfcHapticTarget = {
        onDeskCheckin,
        onDeskCheckout,
        onTapRejected,
      };
      bindNfcDeskHaptics(target);

      target.onDeskCheckin?.("d1", "u1", 5);
      target.onDeskCheckout?.("d1", "u1", 6);
      target.onTapRejected?.("d1", "nope");

      expect(onDeskCheckin).toHaveBeenCalledWith("d1", "u1", 5);
      expect(onDeskCheckout).toHaveBeenCalledWith("d1", "u1", 6);
      expect(onTapRejected).toHaveBeenCalledWith("d1", "nope");
    });

    it("still runs existing callbacks when vibration is unsupported", () => {
      setVibrate(undefined);
      const onDeskCheckin = jest.fn();
      const target: NfcHapticTarget = { onDeskCheckin };
      bindNfcDeskHaptics(target);
      expect(() => target.onDeskCheckin?.("d1", "u1", 1)).not.toThrow();
      expect(onDeskCheckin).toHaveBeenCalledTimes(1);
    });

    it("restores the previous callbacks when unbound", () => {
      const onDeskCheckin = jest.fn();
      const target: NfcHapticTarget = { onDeskCheckin };
      const unbind = bindNfcDeskHaptics(target);
      expect(target.onDeskCheckin).not.toBe(onDeskCheckin);

      unbind();
      expect(target.onDeskCheckin).toBe(onDeskCheckin);
      expect(target.onDeskCheckout).toBeUndefined();
      expect(target.onTapRejected).toBeUndefined();

      target.onDeskCheckin?.("d1", "u1", 1);
      expect(vibrate).not.toHaveBeenCalled();
    });
  });
});
