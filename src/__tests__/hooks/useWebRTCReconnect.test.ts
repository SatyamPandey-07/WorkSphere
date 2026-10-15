import { renderHook, act } from "@testing-library/react";
import {
  useWebRTCReconnect,
  calculateBackoffDelay,
  performIceRestart,
  DEFAULT_MAX_RETRIES,
} from "@/hooks/useWebRTCReconnect";

describe("useWebRTCReconnect", () => {
  let mockPC: any;
  let mockConnection: any;

  beforeEach(() => {
    jest.useFakeTimers();

    mockPC = {
      iceConnectionState: "connected",
      restartIce: jest.fn(),
      createOffer: jest.fn().mockResolvedValue({
        type: "offer",
        sdp: "v=0\r\no=mock 123 456\r\na=ice-options:trickle\r\n",
      }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    mockConnection = {
      type: "cellular",
      effectiveType: "4g",
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    Object.defineProperty(global.navigator, "connection", {
      value: mockConnection,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("calculateBackoffDelay", () => {
    it("calculates exponential backoff delay correctly", () => {
      expect(calculateBackoffDelay(1, 300, 2)).toBe(300);
      expect(calculateBackoffDelay(2, 300, 2)).toBe(600);
      expect(calculateBackoffDelay(3, 300, 2)).toBe(1200);
    });

    it("handles non-positive attempts gracefully", () => {
      expect(calculateBackoffDelay(0, 300, 2)).toBe(300);
      expect(calculateBackoffDelay(-1, 300, 2)).toBe(300);
    });
  });

  describe("performIceRestart", () => {
    it("invokes restartIce, createOffer with iceRestart: true, and setLocalDescription", async () => {
      const onSignalingSend = jest.fn();

      const offer = await performIceRestart(mockPC, "peer-123", onSignalingSend);

      expect(mockPC.restartIce).toHaveBeenCalledTimes(1);
      expect(mockPC.createOffer).toHaveBeenCalledWith({ iceRestart: true });
      expect(mockPC.setLocalDescription).toHaveBeenCalledWith(offer);
      expect(onSignalingSend).toHaveBeenCalledWith({
        type: "webrtc-signal",
        kind: "offer",
        peerId: "peer-123",
        sdp: offer,
        iceRestart: true,
      });
    });

    it("handles browsers where pc.restartIce is not a function", async () => {
      const legacyPC = { ...mockPC, restartIce: undefined };
      const onSignalingSend = jest.fn();

      const offer = await performIceRestart(legacyPC, "peer-456", onSignalingSend);
      expect(legacyPC.createOffer).toHaveBeenCalledWith({ iceRestart: true });
      expect(offer).toBeDefined();
    });
  });

  describe("useWebRTCReconnect Hook", () => {
    it("initializes with default state", () => {
      const { result } = renderHook(() =>
        useWebRTCReconnect({ peerConnection: mockPC })
      );

      expect(result.current.isReconnecting).toBe(false);
      expect(result.current.retryCount).toBe(0);
      expect(result.current.networkType).toBe("cellular");
      expect(result.current.effectiveType).toBe("4g");
    });

    it("registers listeners for ICE state and connection changes", () => {
      renderHook(() => useWebRTCReconnect({ peerConnection: mockPC }));

      expect(mockPC.addEventListener).toHaveBeenCalledWith(
        "iceconnectionstatechange",
        expect.any(Function)
      );
      expect(mockConnection.addEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function)
      );
    });

    it("triggers ICE restart when triggerIceRestart is called", async () => {
      const onSignalingSend = jest.fn();
      const onIceRestart = jest.fn();

      const { result } = renderHook(() =>
        useWebRTCReconnect({
          peerConnection: mockPC,
          onSignalingSend,
          onIceRestart,
        })
      );

      let promise: Promise<boolean>;
      act(() => {
        promise = result.current.triggerIceRestart("peer-1");
      });

      expect(result.current.isReconnecting).toBe(true);
      expect(result.current.retryCount).toBe(1);

      // Advance timers to trigger backoff timeout
      await act(async () => {
        jest.advanceTimersByTime(300);
        await promise;
      });

      expect(mockPC.createOffer).toHaveBeenCalledWith({ iceRestart: true });
      expect(onIceRestart).toHaveBeenCalledWith("peer-1");
    });

    it("caps retry attempts at 3 and fires onReconnectFailed", async () => {
      const onReconnectFailed = jest.fn();

      const { result } = renderHook(() =>
        useWebRTCReconnect({
          peerConnection: mockPC,
          maxRetries: 3,
          onReconnectFailed,
        })
      );

      // Attempt 1
      await act(async () => {
        result.current.triggerIceRestart("peer-1");
        jest.advanceTimersByTime(300);
      });
      expect(result.current.retryCount).toBe(1);

      // Attempt 2
      await act(async () => {
        result.current.triggerIceRestart("peer-1");
        jest.advanceTimersByTime(600);
      });
      expect(result.current.retryCount).toBe(2);

      // Attempt 3
      await act(async () => {
        result.current.triggerIceRestart("peer-1");
        jest.advanceTimersByTime(1200);
      });
      expect(result.current.retryCount).toBe(3);

      // Attempt 4 should be rejected because maxRetries (3) reached
      await act(async () => {
        const success = await result.current.triggerIceRestart("peer-1");
        expect(success).toBe(false);
      });

      expect(onReconnectFailed).toHaveBeenCalledWith("peer-1", expect.any(Error));
    });

    it("resets retryCount when resetRetryCount is called", async () => {
      const { result } = renderHook(() =>
        useWebRTCReconnect({ peerConnection: mockPC })
      );

      act(() => {
        result.current.triggerIceRestart();
      });
      expect(result.current.retryCount).toBe(1);

      act(() => {
        result.current.resetRetryCount();
      });

      expect(result.current.retryCount).toBe(0);
      expect(result.current.isReconnecting).toBe(false);
    });
  });
});
