import {
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_SESSION_STORAGE_KEY,
  savePasskeyChallengeToSession,
  getValidPasskeyChallengeFromSession,
  clearPasskeyChallengeFromSession,
  setupPasskeyUnloadCleanup,
} from "@/lib/passkey";

describe("Passkey Session Storage Challenge Management (#3935)", () => {
  let mockSessionStorage: Record<string, string>;

  beforeEach(() => {
    mockSessionStorage = {};

    // Mock window and sessionStorage
    Object.defineProperty(window, "sessionStorage", {
      value: {
        getItem: jest.fn((key: string) => mockSessionStorage[key] || null),
        setItem: jest.fn((key: string, value: string) => {
          mockSessionStorage[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
          delete mockSessionStorage[key];
        }),
        clear: jest.fn(() => {
          mockSessionStorage = {};
        }),
      },
      writable: true,
      configurable: true,
    });

    jest.restoreAllMocks();
  });

  afterEach(() => {
    clearPasskeyChallengeFromSession();
  });

  it("should have a 5-minute TTL constant defined", () => {
    expect(PASSKEY_CHALLENGE_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("should save challenge with createdAt timestamp and 5-minute expiration", () => {
    const fakeNow = 1700000000000;
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);

    const result = savePasskeyChallengeToSession("test-challenge-123", "authentication");

    expect(result).not.toBeNull();
    expect(result?.challenge).toBe("test-challenge-123");
    expect(result?.ceremonyType).toBe("authentication");
    expect(result?.createdAt).toBe(fakeNow);
    expect(result?.expiresAt).toBe(fakeNow + 5 * 60 * 1000);

    const storedRaw = window.sessionStorage.getItem(PASSKEY_SESSION_STORAGE_KEY);
    expect(storedRaw).toBeTruthy();
    const stored = JSON.parse(storedRaw!);
    expect(stored.challenge).toBe("test-challenge-123");
    expect(stored.expiresAt).toBe(fakeNow + 5 * 60 * 1000);
  });

  it("should return the stored challenge if within the 5-minute TTL", () => {
    const fakeNow = 1700000000000;
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);

    savePasskeyChallengeToSession("valid-challenge", "registration");

    // Advance 4 minutes (still within 5 minutes window)
    jest.spyOn(Date, "now").mockReturnValue(fakeNow + 4 * 60 * 1000);

    const retrieved = getValidPasskeyChallengeFromSession("registration");
    expect(retrieved).toBe("valid-challenge");
  });

  it("should reject and discard challenge if older than 5 minutes", () => {
    const fakeNow = 1700000000000;
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);

    savePasskeyChallengeToSession("expired-challenge", "registration");

    // Advance 5 minutes + 1 millisecond
    jest.spyOn(Date, "now").mockReturnValue(fakeNow + 5 * 60 * 1000 + 1);

    const retrieved = getValidPasskeyChallengeFromSession("registration");
    expect(retrieved).toBeNull();

    // Verify it was purged from sessionStorage
    expect(window.sessionStorage.getItem(PASSKEY_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("should clear old challenge when ceremonyType mismatches", () => {
    const fakeNow = 1700000000000;
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);

    savePasskeyChallengeToSession("challenge-abc", "authentication");

    const retrieved = getValidPasskeyChallengeFromSession("registration");
    expect(retrieved).toBeNull();
    expect(window.sessionStorage.getItem(PASSKEY_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("should clear challenge on clearPasskeyChallengeFromSession()", () => {
    savePasskeyChallengeToSession("challenge-xyz", "step_up");
    expect(window.sessionStorage.getItem(PASSKEY_SESSION_STORAGE_KEY)).toBeTruthy();

    clearPasskeyChallengeFromSession();
    expect(window.sessionStorage.getItem(PASSKEY_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("should setup beforeunload and pagehide listeners to clean challenge on tab close", () => {
    savePasskeyChallengeToSession("unload-challenge", "authentication");
    expect(window.sessionStorage.getItem(PASSKEY_SESSION_STORAGE_KEY)).toBeTruthy();

    const cleanup = setupPasskeyUnloadCleanup();

    // Simulate pagehide / tab close
    window.dispatchEvent(new Event("pagehide"));

    expect(window.sessionStorage.getItem(PASSKEY_SESSION_STORAGE_KEY)).toBeNull();

    cleanup();
  });
});
