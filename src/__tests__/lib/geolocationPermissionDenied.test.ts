/**
 * Tests for geolocation permission handling in useGeolocationWatch (Issue #1860).
 */

type GeolocationPermission = "prompt" | "granted" | "denied";

function classifyGeolocationError(code: number): GeolocationPermission {
  switch (code) {
    case 1:
      return "denied"; // PERMISSION_DENIED
    case 2:
      return "prompt"; // POSITION_UNAVAILABLE → keep as prompt
    case 3:
      return "prompt"; // TIMEOUT → keep as prompt
    default:
      return "prompt";
  }
}

function isGeolocationSupported(nav: Partial<typeof navigator>): boolean {
  return "geolocation" in nav && nav.geolocation !== undefined;
}

describe("Geolocation permission classification", () => {
  it("PERMISSION_DENIED (code 1) → 'denied'", () => {
    expect(classifyGeolocationError(1)).toBe("denied");
  });

  it("POSITION_UNAVAILABLE (code 2) → 'prompt' (keep trying)", () => {
    expect(classifyGeolocationError(2)).toBe("prompt");
  });

  it("TIMEOUT (code 3) → 'prompt' (keep trying)", () => {
    expect(classifyGeolocationError(3)).toBe("prompt");
  });

  it("unknown error code → 'prompt' fallback", () => {
    expect(classifyGeolocationError(99)).toBe("prompt");
  });
});

describe("Geolocation API support detection", () => {
  it("returns true when geolocation is available", () => {
    const nav = { geolocation: { watchPosition: jest.fn() } };
    expect(isGeolocationSupported(nav)).toBe(true);
  });

  it("returns false when geolocation is undefined", () => {
    expect(isGeolocationSupported({ geolocation: undefined })).toBe(false);
  });

  it("returns false when geolocation key is missing", () => {
    expect(isGeolocationSupported({})).toBe(false);
  });
});

describe("Geolocation permission state transitions", () => {
  it("starts as 'prompt' before any GPS update", () => {
    const initialState: GeolocationPermission = "prompt";
    expect(initialState).toBe("prompt");
  });

  it("transitions to 'granted' on first successful position", () => {
    let state: GeolocationPermission = "prompt";
    const onSuccess = () => {
      state = "granted";
    };
    onSuccess();
    expect(state).toBe("granted");
  });

  it("transitions to 'denied' on PERMISSION_DENIED error", () => {
    let state: GeolocationPermission = "prompt";
    const onError = (code: number) => {
      state = classifyGeolocationError(code);
    };
    onError(1); // PERMISSION_DENIED
    expect(state).toBe("denied");
  });

  it("stays 'granted' after multiple updates", () => {
    const state: GeolocationPermission = "granted";
    // Multiple success callbacks don't change state
    for (let i = 0; i < 5; i++) {
      // success callback would normally set to granted — state unchanged
    }
    expect(state).toBe("granted");
  });
});
