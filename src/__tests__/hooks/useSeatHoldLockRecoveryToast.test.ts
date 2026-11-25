import { renderHook, act } from "@testing-library/react";
import { useSeatHoldLock } from "@/hooks/useSeatHoldLock";

let socketOptions: {
  onOpen?: () => void;
  onMessage?: (event: { data: string }) => void;
} = {};

const mockSend = jest.fn();
const mockGetToken = jest.fn();
const mockToast = jest.fn();

jest.mock("@/hooks/usePartySocketReconnect", () => ({
  __esModule: true,
  default: jest.fn((options) => {
    socketOptions = options;
    return { send: mockSend, close: jest.fn(), reconnect: jest.fn() };
  }),
}));

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    userId: "user-alice",
    getToken: mockGetToken,
    isLoaded: true,
    isSignedIn: true,
  }),
  useUser: () => ({
    user: { firstName: "Alice", lastName: "Smith", username: "alice" },
  }),
}));

jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

async function renderHookReady(
  options: Parameters<typeof useSeatHoldLock>[0],
) {
  const hook = renderHook(() => useSeatHoldLock(options));
  const tokenResult = mockGetToken.mock.results[0];
  await act(async () => {
    if (tokenResult?.type === "return") await tokenResult.value;
  });
  act(() => {
    socketOptions.onOpen?.();
  });
  return hook;
}

function deliver(payload: Record<string, unknown>) {
  act(() => {
    socketOptions.onMessage?.({ data: JSON.stringify(payload) });
  });
}

function lastExpiredToast() {
  const call = mockToast.mock.calls.find(
    ([, , opts]) => opts?.key === "seat-lock-expired:seat-1",
  );
  return call as
    | [string, string, { key: string; countdown: number; action: { label: string; onClick: () => void } }]
    | undefined;
}

describe("useSeatHoldLock lock recovery toast (#7943)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockReset().mockResolvedValue("clerk-token");
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-21T10:00:00Z"));
    socketOptions = {};
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("shows an Extend Hold countdown toast when lock_expired arrives", async () => {
    const onLockExpired = jest.fn();
    await renderHookReady({ venueId: "venue-1", onLockExpired });

    deliver({ type: "lock_expired", seatId: "seat-1", venueId: "venue-1" });

    const toastCall = lastExpiredToast();
    expect(toastCall).toBeDefined();
    const [message, type, opts] = toastCall!;
    expect(message).toContain("{countdown}");
    expect(type).toBe("warning");
    expect(opts.countdown).toBe(30);
    expect(opts.action.label).toBe("Extend Hold");
    expect(onLockExpired).toHaveBeenCalledWith("seat-1", 30_000);
  });

  it("uses the grace window sent by the server", async () => {
    await renderHookReady({ venueId: "venue-1" });

    deliver({ type: "lock_expired", seatId: "seat-1", graceMs: 45_000 });

    expect(lastExpiredToast()![2].countdown).toBe(45);
  });

  it("Extend Hold re-requests the seat and confirms on success", async () => {
    const onHoldExtended = jest.fn();
    const { result } = await renderHookReady({
      venueId: "venue-1",
      onHoldExtended,
    });
    deliver({ type: "lock_expired", seatId: "seat-1" });
    mockSend.mockClear();

    await act(async () => {
      lastExpiredToast()![2].action.onClick();
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSend.mock.calls[0][0])).toMatchObject({
      type: "seat_hold_request",
      seatId: "seat-1",
      venueId: "venue-1",
      userId: "user-alice",
    });

    await act(async () => {
      socketOptions.onMessage?.({
        data: JSON.stringify({
          type: "seat_hold_acquired",
          seatId: "seat-1",
          venueId: "venue-1",
          expiresAt: Date.now() + 300_000,
        }),
      });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("extended"),
      "success",
      expect.objectContaining({ key: "seat-lock-extended:seat-1" }),
    );
    expect(onHoldExtended).toHaveBeenCalledWith("seat-1", expect.any(Number));
    expect(result.current.myHeldSeatId).toBe("seat-1");
  });

  it("shows an error and skips onHoldExtended when someone else took the seat", async () => {
    const onHoldExtended = jest.fn();
    await renderHookReady({ venueId: "venue-1", onHoldExtended });
    deliver({ type: "lock_expired", seatId: "seat-1" });

    await act(async () => {
      lastExpiredToast()![2].action.onClick();
    });
    await act(async () => {
      socketOptions.onMessage?.({
        data: JSON.stringify({
          type: "seat_hold_rejected",
          seatId: "seat-1",
          venueId: "venue-1",
          reason: "ALREADY_HELD",
          heldBy: "user-bob",
          heldByName: "Bob",
          expiresAt: Date.now() + 120_000,
        }),
      });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't extend"),
      "error",
      expect.objectContaining({ key: "seat-lock-extended:seat-1" }),
    );
    expect(onHoldExtended).not.toHaveBeenCalled();
  });

  it("can be turned off while still reporting onLockExpired", async () => {
    const onLockExpired = jest.fn();
    await renderHookReady({
      venueId: "venue-1",
      showLockRecoveryToast: false,
      onLockExpired,
    });

    deliver({ type: "lock_expired", seatId: "seat-1" });

    expect(mockToast).not.toHaveBeenCalled();
    expect(onLockExpired).toHaveBeenCalledTimes(1);
  });

  it("ignores lock_expired for a different venue", async () => {
    await renderHookReady({ venueId: "venue-1" });

    deliver({ type: "lock_expired", seatId: "seat-1", venueId: "venue-2" });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("ignores a late lock_expired when the hold was already renewed", async () => {
    await renderHookReady({ venueId: "venue-1" });
    deliver({
      type: "seat_hold_acquired",
      seatId: "seat-1",
      venueId: "venue-1",
      expiresAt: Date.now() + 300_000,
    });

    deliver({ type: "lock_expired", seatId: "seat-1", venueId: "venue-1" });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("prompts at local expiry and does not repeat when lock_expired follows", async () => {
    const onHoldExpired = jest.fn();
    await renderHookReady({ venueId: "venue-1", onHoldExpired });
    deliver({
      type: "seat_hold_acquired",
      seatId: "seat-1",
      venueId: "venue-1",
      expiresAt: Date.now() + 2000,
    });

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(onHoldExpired).toHaveBeenCalledWith("seat-1");
    const expiredCalls = () =>
      mockToast.mock.calls.filter(
        ([, , opts]) => opts?.key === "seat-lock-expired:seat-1",
      );
    expect(expiredCalls()).toHaveLength(1);

    deliver({ type: "lock_expired", seatId: "seat-1", venueId: "venue-1" });

    expect(expiredCalls()).toHaveLength(1);
  });

  it("does not prompt when another user's hold expires locally", async () => {
    await renderHookReady({ venueId: "venue-1" });
    deliver({
      type: "seat_locked",
      seatId: "seat-1",
      venueId: "venue-1",
      heldBy: "user-bob",
      heldByName: "Bob",
      expiresAt: Date.now() + 1000,
    });

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });
});
