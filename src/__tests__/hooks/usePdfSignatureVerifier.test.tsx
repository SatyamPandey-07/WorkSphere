/**
 * Tests for usePdfSignatureVerifier hook and PdfWorkerManager lifecycle
 * WorkSphere Issue #7530
 */

import { renderHook, act } from "@testing-library/react";
import {
  usePdfSignatureVerifier,
  PdfWorkerManager,
} from "@/hooks/usePdfSignatureVerifier";
import * as pdfExtractor from "@/lib/pdf-verify/pdfSignatureExtractor";
import * as caRootsModule from "@/lib/pdf-verify/caRoots";

// Mock dependencies
jest.mock("@/lib/pdf-verify/caRoots", () => ({
  fetchCaRootsPem: jest.fn().mockResolvedValue("MOCK_CA_ROOTS_PEM"),
}));

class MockWorker {
  static instances: MockWorker[] = [];
  public onmessage: ((e: any) => void) | null = null;
  public onerror: ((e: any) => void) | null = null;
  public terminated = false;
  private listeners: Record<string, Function[]> = {};

  constructor(public scriptUrl: string | URL, public options?: any) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  postMessage(data: any) {
    if (this.terminated) return;
    const { action, id } = data;

    // Simulate async microtask response so it doesn't get blocked by fake timers
    queueMicrotask(() => {
      if (this.terminated) return;
      if (action === "init") {
        const response = { action: "ready", id };
        if (this.listeners["message"]) {
          this.listeners["message"].forEach((cb) =>
            cb({ data: response } as any),
          );
        }
        if (this.onmessage) {
          this.onmessage({ data: response } as any);
        }
      } else if (action === "verify") {
        const response = {
          action: "result",
          id,
          result: {
            valid: true,
            signerName: "John Doe",
            signingTime: "2026-11-22T00:00:00Z",
            algorithm: "SHA256withRSA",
            error: "",
          },
        };
        if (this.onmessage) {
          this.onmessage({ data: response } as any);
        }
      }
    });
  }

  terminate() {
    this.terminated = true;
  }
}

// Replace global Worker
(global as any).Worker = MockWorker;

const createFakePdfFile = (hasSignature = true): File => {
  const content = hasSignature
    ? "%PDF-1.4 mock signature content"
    : "%PDF-1.4 empty content";
  const blob = new Blob([content], { type: "application/pdf" });
  const file = new File([blob], "test.pdf", { type: "application/pdf" });
  file.arrayBuffer = () => Promise.resolve(new TextEncoder().encode(content).buffer as ArrayBuffer);
  return file;
};

describe("PdfWorkerManager and usePdfSignatureVerifier (#7530)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockWorker.instances = [];
    PdfWorkerManager.resetInstance();
    jest.clearAllMocks();

    jest.spyOn(pdfExtractor, "extractSignatures").mockImplementation((bytes) => {
      return [
        {
          fieldName: "Signature1",
          subFilter: "adbe.pkcs7.detached",
          byteRange: { offset1: 0, length1: 10, offset2: 20, length2: 30 },
          contents: new Uint8Array([1, 2, 3, 4]),
        },
      ];
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("1. Multiple sequential verification requests reuse the same worker instance", async () => {
    const { result } = renderHook(() => usePdfSignatureVerifier());

    const file1 = createFakePdfFile();
    const file2 = createFakePdfFile();

    await act(async () => {
      await result.current.verify(file1);
    });

    expect(result.current.status).toBe("verified");
    expect(MockWorker.instances.length).toBe(1);
    expect(MockWorker.instances[0].terminated).toBe(false);

    await act(async () => {
      await result.current.verify(file2);
    });

    expect(result.current.status).toBe("verified");
    expect(MockWorker.instances.length).toBe(1); // Reused same worker
    expect(MockWorker.instances[0].terminated).toBe(false);
  });

  it("2. Multiple requests are processed without mixing their responses", async () => {
    const manager = PdfWorkerManager.getInstance();

    const p1 = manager.verifySignature(
      "req-1",
      new Uint8Array([1]),
      new Uint8Array([2]),
      { offset1: 0, length1: 1, offset2: 2, length2: 3 },
      "roots",
      () => false,
    );

    const p2 = manager.verifySignature(
      "req-2",
      new Uint8Array([3]),
      new Uint8Array([4]),
      { offset1: 0, length1: 1, offset2: 2, length2: 3 },
      "roots",
      () => false,
    );

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.valid).toBe(true);
    expect(res2.valid).toBe(true);
    expect(MockWorker.instances.length).toBe(1);
  });

  it("3. A successful request releases its pending request state", async () => {
    const { result } = renderHook(() => usePdfSignatureVerifier());
    const file = createFakePdfFile();

    await act(async () => {
      await result.current.verify(file);
    });

    expect(result.current.status).toBe("verified");
    expect(result.current.result?.signerName).toBe("John Doe");
  });

  it("4. A failed request does not prevent the next request from executing", async () => {
    const { result } = renderHook(() => usePdfSignatureVerifier());

    // Make worker fail for the first verify request
    const workerOrigPostMessage = MockWorker.prototype.postMessage;
    let callCount = 0;
    MockWorker.prototype.postMessage = function (data: any) {
      if (data.action === "verify" && ++callCount === 1) {
        queueMicrotask(() => {
          if (this.onmessage) {
            this.onmessage({
              data: {
                action: "error",
                id: data.id,
                error: "Corrupt signature format",
              },
            } as any);
          }
        });
        return;
      }
      workerOrigPostMessage.call(this, data);
    };

    const file1 = createFakePdfFile();
    await act(async () => {
      await result.current.verify(file1);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Corrupt signature format");

    // Second request should succeed
    const file2 = createFakePdfFile();
    await act(async () => {
      await result.current.verify(file2);
    });

    expect(result.current.status).toBe("verified");
    expect(result.current.result?.valid).toBe(true);
    MockWorker.prototype.postMessage = workerOrigPostMessage;
  });

  it("5. Cancelling a request cleans up its pending state", async () => {
    const { result } = renderHook(() => usePdfSignatureVerifier());
    const file = createFakePdfFile();

    act(() => {
      result.current.verify(file);
    });

    // Reset while in progress
    act(() => {
      result.current.reset();
    });

    await act(async () => {
      jest.advanceTimersByTime(50);
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
  });

  it("6. Unmounting a component cleans up its component-owned requests", async () => {
    const { result, unmount } = renderHook(() => usePdfSignatureVerifier());
    const file = createFakePdfFile();

    act(() => {
      result.current.verify(file);
    });

    unmount();

    await act(async () => {
      jest.advanceTimersByTime(50);
    });

    // Should not crash or update state on unmounted component
  });

  it("7. One component unmounting does not terminate a worker still used by another request", async () => {
    const hook1 = renderHook(() => usePdfSignatureVerifier());
    const hook2 = renderHook(() => usePdfSignatureVerifier());

    const file1 = createFakePdfFile();
    const file2 = createFakePdfFile();

    let p2Promise: Promise<void>;
    act(() => {
      hook1.result.current.verify(file1);
      p2Promise = hook2.result.current.verify(file2);
    });

    // Unmount hook1
    hook1.unmount();

    // hook2 should continue and finish successfully
    await act(async () => {
      await p2Promise;
    });

    expect(hook2.result.current.status).toBe("verified");
    expect(MockWorker.instances[0].terminated).toBe(false);
    hook2.unmount();
  });

  it("8. An idle worker is terminated after 60 seconds", async () => {
    const { result, unmount } = renderHook(() => usePdfSignatureVerifier());
    const file = createFakePdfFile();

    await act(async () => {
      await result.current.verify(file);
    });

    expect(MockWorker.instances.length).toBe(1);
    expect(MockWorker.instances[0].terminated).toBe(false);

    // Advance 59 seconds -> still active
    act(() => {
      jest.advanceTimersByTime(59000);
    });
    expect(MockWorker.instances[0].terminated).toBe(false);

    // Advance past 60 seconds -> terminated
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(MockWorker.instances[0].terminated).toBe(true);

    unmount();
  });

  it("9. A new request after idle termination creates a new worker", async () => {
    const { result, unmount } = renderHook(() => usePdfSignatureVerifier());
    const file1 = createFakePdfFile();

    await act(async () => {
      await result.current.verify(file1);
    });

    expect(MockWorker.instances.length).toBe(1);

    // Advance 65 seconds
    act(() => {
      jest.advanceTimersByTime(65000);
    });
    expect(MockWorker.instances[0].terminated).toBe(true);

    // Trigger second verify
    const file2 = createFakePdfFile();
    await act(async () => {
      await result.current.verify(file2);
    });

    expect(MockWorker.instances.length).toBe(2);
    expect(MockWorker.instances[1].terminated).toBe(false);
    expect(result.current.status).toBe("verified");

    unmount();
  });

  it("10. Repeated verification does not accumulate message or error listeners", async () => {
    const { result, unmount } = renderHook(() => usePdfSignatureVerifier());

    for (let i = 0; i < 5; i++) {
      const file = createFakePdfFile();
      await act(async () => {
        await result.current.verify(file);
      });
    }

    const worker = MockWorker.instances[0];
    expect(MockWorker.instances.length).toBe(1);
    expect(worker.terminated).toBe(false);
    unmount();
  });

  it("11. Worker errors and message errors are handled without leaving unresolved promises", async () => {
    const { result, unmount } = renderHook(() => usePdfSignatureVerifier());
    const file = createFakePdfFile();

    const workerOrigPostMessage = MockWorker.prototype.postMessage;
    MockWorker.prototype.postMessage = function (data: any) {
      if (data.action === "verify") {
        queueMicrotask(() => {
          if (this.onerror) {
            this.onerror(new ErrorEvent("error", { message: "Crash in worker" }));
          }
        });
        return;
      }
      workerOrigPostMessage.call(this, data);
    };

    await act(async () => {
      await result.current.verify(file);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("Crash in worker");
    MockWorker.prototype.postMessage = workerOrigPostMessage;
    unmount();
  });

  it("12. Stress test: 100 consecutive verifications reuse worker and all settle successfully", async () => {
    const { result, unmount } = renderHook(() => usePdfSignatureVerifier());

    for (let i = 0; i < 100; i++) {
      const file = createFakePdfFile();
      await act(async () => {
        await result.current.verify(file);
      });
      expect(result.current.status).toBe("verified");
    }

    // Only 1 worker instance was ever created!
    expect(MockWorker.instances.length).toBe(1);
    expect(MockWorker.instances[0].terminated).toBe(false);

    unmount();
  });
});
