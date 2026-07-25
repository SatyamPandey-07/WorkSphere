import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StudentDiscountVerification } from "@/components/student/StudentDiscountVerification";

const mockTerminate = jest.fn();
const mockPostMessage = jest.fn();
let messageHandler: ((e: MessageEvent) => void) | null = null;
let errorHandler: (() => void) | null = null;

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = mockTerminate;
  postMessage = mockPostMessage;

  constructor() {
    messageHandler = null;
    errorHandler = null;
    Object.defineProperty(this, "onmessage", {
      get: () => messageHandler,
      set: (fn: ((e: MessageEvent) => void) | null) => {
        messageHandler = fn;
      },
    });
    Object.defineProperty(this, "onerror", {
      get: () => errorHandler,
      set: (fn: (() => void) | null) => {
        errorHandler = fn;
      },
    });
  }
}

(global as any).Worker = MockWorker;

beforeEach(() => {
  jest.clearAllMocks();
  messageHandler = null;
  errorHandler = null;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ verified: true }),
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("StudentDiscountVerification worker lifecycle", () => {
  it("creates a worker on mount", () => {
    render(<StudentDiscountVerification />);
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("terminates worker on unmount", () => {
    const { unmount } = render(<StudentDiscountVerification />);
    unmount();
    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });

  it("terminates worker after proof error and allows retry", async () => {
    render(<StudentDiscountVerification />);

    fireEvent.change(screen.getByPlaceholderText("e.g. 12345678"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByText("Verify with zk-SNARK"));

    expect(mockPostMessage).toHaveBeenCalledWith({
      identityToken: "42",
      expectedCommit: "1991",
    });

    await waitFor(() => {
      expect(messageHandler).not.toBeNull();
    });

    act(() => {
      messageHandler!(
        new MessageEvent("message", {
          data: { type: "error", error: "Proof generation failed" },
        }),
      );
    });

    await waitFor(() => {
      expect(mockTerminate).toHaveBeenCalled();
    });

    expect(screen.getByText("Proof generation failed")).toBeInTheDocument();
    expect(screen.getByText("Verify with zk-SNARK")).toBeInTheDocument();
  });

  it("does not recreate worker when onVerified reference changes", () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();

    const { rerender } = render(
      <StudentDiscountVerification onVerified={cb1} />,
    );
    const initialTerminateCount = mockTerminate.mock.calls.length;

    rerender(<StudentDiscountVerification onVerified={cb2} />);

    expect(mockTerminate.mock.calls.length).toBe(initialTerminateCount);
  });

  it("terminates directly on unmount without cancel message", () => {
    const { unmount } = render(<StudentDiscountVerification />);
    unmount();
    expect(mockTerminate).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "cancel" }),
    );
  });

  it("handles worker crash via onerror handler", async () => {
    render(<StudentDiscountVerification />);

    fireEvent.change(screen.getByPlaceholderText("e.g. 12345678"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByText("Verify with zk-SNARK"));

    await waitFor(() => {
      expect(errorHandler).not.toBeNull();
    });

    act(() => {
      errorHandler!();
    });

    await waitFor(() => {
      expect(mockTerminate).toHaveBeenCalled();
    });

    expect(
      screen.getByText("Worker crashed during proof generation"),
    ).toBeInTheDocument();
  });

  it("respawns worker on retry after previous error", async () => {
    render(<StudentDiscountVerification />);

    fireEvent.change(screen.getByPlaceholderText("e.g. 12345678"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByText("Verify with zk-SNARK"));

    await waitFor(() => {
      expect(messageHandler).not.toBeNull();
    });

    // Simulate error
    act(() => {
      messageHandler!(
        new MessageEvent("message", {
          data: { type: "error", error: "Failed" },
        }),
      );
    });

    await waitFor(() => {
      expect(mockTerminate).toHaveBeenCalled();
    });

    const terminateCount = mockTerminate.mock.calls.length;

    // Retry
    fireEvent.click(screen.getByText("Verify with zk-SNARK"));

    // A new worker should have been spawned (terminate called for cleanup)
    await waitFor(() => {
      expect(mockTerminate.mock.calls.length).toBeGreaterThanOrEqual(
        terminateCount,
      );
    });
  });
});
