import { renderHook, act } from "@testing-library/react";
import { useMeshDataChannels } from "@/hooks/useMeshDataChannels";

// Mock @clerk/nextjs
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: null,
  }),
}));

// Mock partysocket/react
let mockPartySocketOnMessage: ((event: { data: string }) => void) | null = null;
const mockSocketSend = jest.fn();

jest.mock("partysocket/react", () => {
  return jest.fn().mockImplementation((config) => {
    mockPartySocketOnMessage = config.onMessage;
    return {
      send: mockSocketSend,
      close: jest.fn(),
    };
  });
});

class MockRTCDataChannel {
  public label: string;
  public readyState: string = "open";
  public onmessage: ((ev: { data: any }) => void) | null = null;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;

  constructor(label: string) {
    this.label = label;
  }

  send = jest.fn();
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
}

let latestDataChannel: MockRTCDataChannel | null = null;

class MockRTCPeerConnection {
  public onicecandidate: any = null;
  public ondatachannel: any = null;
  public oniceconnectionstatechange: any = null;
  public iceConnectionState: string = "connected";

  createDataChannel(label: string) {
    const dc = new MockRTCDataChannel(label);
    latestDataChannel = dc;
    return dc;
  }

  createOffer = jest.fn().mockResolvedValue({ type: "offer", sdp: "mock-sdp" });
  setLocalDescription = jest.fn().mockResolvedValue(undefined);
  setRemoteDescription = jest.fn().mockResolvedValue(undefined);
  createAnswer = jest
    .fn()
    .mockResolvedValue({ type: "answer", sdp: "mock-answer" });
  addIceCandidate = jest.fn().mockResolvedValue(undefined);
  close = jest.fn();
}

describe("useMeshDataChannels Hook Deduplication Integration", () => {
  let originalRTCPeerConnection: any;

  beforeAll(() => {
    originalRTCPeerConnection = global.RTCPeerConnection;
    (global as any).RTCPeerConnection = MockRTCPeerConnection;
  });

  afterAll(() => {
    (global as any).RTCPeerConnection = originalRTCPeerConnection;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    latestDataChannel = null;
  });

  it("intercepts duplicate binary messages and drops them before calling onData", () => {
    const onData = jest.fn();
    const { result } = renderHook(() =>
      useMeshDataChannels({
        roomId: "test-room",
        userId: "user-local-1",
        onData,
        enableDeduplication: true,
      }),
    );

    // Simulate incoming signal "peer-join" from peer-2
    act(() => {
      mockPartySocketOnMessage?.({
        data: JSON.stringify({
          type: "webrtc-signal",
          kind: "peer-join",
          from: "peer-2",
        }),
      });
    });

    expect(latestDataChannel).not.toBeNull();
    const dc = latestDataChannel!;

    // Open channel
    act(() => {
      dc.onopen?.();
    });

    const payloadA = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const payloadB = new Uint8Array([9, 8, 7, 6, 5]).buffer;

    // Send payloadA for the first time
    act(() => {
      dc.onmessage?.({ data: payloadA });
    });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenLastCalledWith("peer-2", payloadA);
    expect(result.current.droppedDuplicates).toBe(0);

    // Send identical payloadA a second time (duplicate forwarding)
    act(() => {
      dc.onmessage?.({ data: payloadA });
    });

    // Must NOT call onData again
    expect(onData).toHaveBeenCalledTimes(1);
    expect(result.current.droppedDuplicates).toBe(1);

    // Send payloadB (new message)
    act(() => {
      dc.onmessage?.({ data: payloadB });
    });

    // Must deliver payloadB
    expect(onData).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenLastCalledWith("peer-2", payloadB);
    expect(result.current.droppedDuplicates).toBe(1);

    result.current.bloomFilter?.destroy();
  });

  it("allows duplicate payloads when enableDeduplication is false", () => {
    const onData = jest.fn();
    const { unmount } = renderHook(() =>
      useMeshDataChannels({
        roomId: "test-room",
        userId: "user-local-1",
        onData,
        enableDeduplication: false,
      }),
    );

    act(() => {
      mockPartySocketOnMessage?.({
        data: JSON.stringify({
          type: "webrtc-signal",
          kind: "peer-join",
          from: "peer-3",
        }),
      });
    });

    const dc = latestDataChannel!;
    act(() => {
      dc.onopen?.();
    });

    const payload = new Uint8Array([42, 42, 42]).buffer;

    act(() => {
      dc.onmessage?.({ data: payload });
    });
    expect(onData).toHaveBeenCalledTimes(1);

    act(() => {
      dc.onmessage?.({ data: payload });
    });
    // With deduplication disabled, duplicate is delivered
    expect(onData).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("suppresses echoes of locally broadcasted messages", () => {
    const onData = jest.fn();
    const { result, unmount } = renderHook(() =>
      useMeshDataChannels({
        roomId: "test-room",
        userId: "user-local-1",
        onData,
        enableDeduplication: true,
      }),
    );

    act(() => {
      mockPartySocketOnMessage?.({
        data: JSON.stringify({
          type: "webrtc-signal",
          kind: "peer-join",
          from: "peer-4",
        }),
      });
    });

    const dc = latestDataChannel!;
    act(() => {
      dc.onopen?.();
    });

    const localBroadcast = new Uint8Array([7, 14, 21, 28]).buffer;

    // Broadcast locally
    act(() => {
      result.current.sendToAll(localBroadcast);
    });

    // Remote peer relays/echoes our own message back to us
    act(() => {
      dc.onmessage?.({ data: localBroadcast });
    });

    // onData must NOT be called for our own echoed message
    expect(onData).toHaveBeenCalledTimes(0);
    expect(result.current.droppedDuplicates).toBe(1);

    unmount();
  });

  it("cleans up Bloom filter resources on hook unmount", () => {
    const { result, unmount } = renderHook(() =>
      useMeshDataChannels({
        roomId: "test-room",
        userId: "user-local-1",
      }),
    );

    const bloomFilter = result.current.bloomFilter;
    expect(bloomFilter).not.toBeNull();
    const destroySpy = jest.spyOn(bloomFilter!, "destroy");

    unmount();
    expect(destroySpy).toHaveBeenCalled();
  });
});
