import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useWorkerTokenRefresh } from "@/hooks/useWorkerTokenRefresh";

// Mock Clerk auth
const getTokenMock = jest.fn().mockResolvedValue("fresh-token-123");
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: getTokenMock }),
}));

function createMockWorker(): Worker & {
  _triggerMessage: (data: unknown) => void;
} {
  const listeners: ((e: MessageEvent) => void)[] = [];
  return {
    send: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn(),
    addEventListener: jest.fn((event, cb) => {
      if (event === "message") listeners.push(cb as (e: MessageEvent) => void);
    }),
    removeEventListener: jest.fn(),
    onmessage: null,
    onerror: null,
    dispatchEvent: jest.fn(),
    _triggerMessage: (data: unknown) => {
      listeners.forEach((cb) =>
        cb(new MessageEvent("message", { data })),
      );
    },
  } as unknown as Worker & { _triggerMessage: (d: unknown) => void };
}

describe("useWorkerTokenRefresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers a message listener on the worker", () => {
    const worker = createMockWorker();
    const workerRef = { current: worker };
    renderHook(() => useWorkerTokenRefresh(workerRef));
    expect(worker.addEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  it("does nothing when worker is null", () => {
    const workerRef = { current: null };
    expect(() =>
      renderHook(() => useWorkerTokenRefresh(workerRef as any)),
    ).not.toThrow();
  });

  it("fetches fresh token and posts TOKEN_REFRESH on AUTH_EXPIRED", async () => {
    const worker = createMockWorker();
    const workerRef = { current: worker };
    renderHook(() => useWorkerTokenRefresh(workerRef));

    // Simulate AUTH_EXPIRED from worker
    await (worker as any)._triggerMessage({ type: "AUTH_EXPIRED" });

    // Give microtasks time to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(getTokenMock).toHaveBeenCalledWith({ skipCache: true });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "TOKEN_REFRESH",
      token: "fresh-token-123",
    });
  });

  it("ignores non-AUTH_EXPIRED messages", async () => {
    const worker = createMockWorker();
    const workerRef = { current: worker };
    renderHook(() => useWorkerTokenRefresh(workerRef));

    await (worker as any)._triggerMessage({ type: "WAKE_UP", something: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("removes listener on unmount", () => {
    const worker = createMockWorker();
    const workerRef = { current: worker };
    const { unmount } = renderHook(() => useWorkerTokenRefresh(workerRef));
    unmount();
    expect(worker.removeEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });
});
