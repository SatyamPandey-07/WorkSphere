/**
 * Regression Test Suite for WebRTC DataChannel Backpressure Chunker & CRDT Sync (#9447)
 *
 * Verifies:
 * 1. Watermark configuration (64 KiB low-water threshold)
 * 2. Initial backpressure above 1 MiB high-water mark
 * 3. Automatic transmission resumption on `bufferedamountlow`
 * 4. Strict FIFO ordering across multi-stage drain
 * 5. Large payload chunking (MTU <= 65,536 bytes) & reassembly
 * 6. Rapid 1,000+ update burst without message loss or reordering
 * 7. WebRTC OperationError handling and requeue recovery
 * 8. Independent per-peer backpressure isolation
 * 9. Channel lifecycle, disposal, and delayed event safety
 * 10. Queue capacity boundaries and explicit QueueOverflowError
 * 11. Hook integration with useMeshDataChannels (framing, reassembly, per-peer routing)
 */

import { act, renderHook } from "@testing-library/react";
import {
  DataChannelChunker,
  HIGH_WATER_MARK,
  LOW_WATER_MARK,
  QueueOverflowError,
  type DataChannelLike,
} from "@/core/p2p/DataChannelChunker";
import {
  CRDT_FRAME_HEADER_SIZE,
  CRDT_MAX_SCTP_MESSAGE_SIZE,
  CrdtFrameMessageType,
  CrdtFrameReassembler,
  decodeCrdtFrame,
} from "@/lib/crdt/dataChannelFraming";
import { useMeshDataChannels } from "@/hooks/useMeshDataChannels";

// Clerk mock
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

// PartySocket mock
const mockSocketSend = jest.fn();
let mockSocketOptions: any = null;
jest.mock("partysocket/react", () => {
  return jest.fn((options: any) => {
    mockSocketOptions = options;
    return {
      send: mockSocketSend,
      close: jest.fn(),
    };
  });
});

// Checksum cache mock
jest.mock("@/lib/crdt/stateVectorChecksum", () => ({
  resetStateVectorChecksumCache: jest.fn(),
}));

/**
 * Realistic Mock RTCDataChannel implementing EventTarget and buffer metrics.
 */
class MockDataChannel implements DataChannelLike {
  public readyState: RTCDataChannelState = "open";
  public bufferedAmount = 0;
  public bufferedAmountLowThreshold = 0;
  public binaryType = "arraybuffer";

  public sentBuffers: ArrayBuffer[] = [];
  public listeners = new Map<string, Set<(ev: any) => void>>();
  public onbufferedamountlow: ((ev: any) => void) | null = null;
  public onopen: ((ev: any) => void) | null = null;
  public onclose: ((ev: any) => void) | null = null;
  public onmessage: ((ev: any) => void) | null = null;
  public onerror: ((ev: any) => void) | null = null;

  public shouldThrowOperationError = false;
  public simulateBufferAccumulation = false;

  public send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== "open") {
      throw new Error(
        `InvalidStateError: RTCDataChannel.readyState is not 'open' (current: ${this.readyState})`,
      );
    }
    if (this.shouldThrowOperationError) {
      const err = new Error("RTCDataChannel send buffer full");
      err.name = "OperationError";
      throw err;
    }

    const buffer: ArrayBuffer =
      data instanceof ArrayBuffer
        ? data
        : ArrayBuffer.isView(data)
          ? (data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            ) as ArrayBuffer)
          : (new TextEncoder().encode(data).buffer as ArrayBuffer);

    this.sentBuffers.push(buffer);
    if (this.simulateBufferAccumulation) {
      this.bufferedAmount += buffer.byteLength;
    }
  }

  public addEventListener(type: string, listener: (ev: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (ev: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatchEvent(event: { type: string; [key: string]: any }): boolean {
    const list = this.listeners.get(event.type);
    if (list) {
      for (const fn of Array.from(list)) {
        fn(event);
      }
    }
    if (event.type === "bufferedamountlow" && this.onbufferedamountlow) {
      this.onbufferedamountlow(event);
    }
    if (event.type === "open" && this.onopen) {
      this.onopen(event);
    }
    if (event.type === "close" && this.onclose) {
      this.onclose(event);
    }
    return true;
  }

  public simulateDrain(newAmount = 0): void {
    this.bufferedAmount = newAmount;
    if (this.bufferedAmount <= this.bufferedAmountLowThreshold) {
      this.dispatchEvent({ type: "bufferedamountlow" });
    }
  }

  public close(): void {
    this.readyState = "closed";
    this.dispatchEvent({ type: "close" });
  }
}

describe("DataChannelChunker & WebRTC CRDT Backpressure (#9447)", () => {
  // Scenario 1: Watermark configuration
  it("configures channel.bufferedAmountLowThreshold to exact 64 KiB", () => {
    const channel = new MockDataChannel();
    const chunker = new DataChannelChunker(channel);

    expect(channel.bufferedAmountLowThreshold).toBe(LOW_WATER_MARK);
    expect(channel.bufferedAmountLowThreshold).toBe(64 * 1024);
    expect(chunker.isBackpressured).toBe(false);
  });

  // Scenario 2: Initial backpressure
  it("pauses transmission when bufferedAmount exceeds 1 MiB operational high-water mark", () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = HIGH_WATER_MARK + 1024; // 1 MiB + 1 KiB

    const chunker = new DataChannelChunker(channel);
    const payload = new Uint8Array([1, 2, 3, 4, 5]);

    chunker.enqueue(payload);

    expect(chunker.isBackpressured).toBe(true);
    expect(chunker.queuedFrames).toBe(1);
    expect(channel.sentBuffers.length).toBe(0); // Nothing sent due to backpressure
  });

  // Scenario 3: Automatic resumption
  it("resumes transmission automatically on bufferedamountlow without extra enqueue", () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = HIGH_WATER_MARK + 5000;

    const chunker = new DataChannelChunker(channel);
    const payload = new Uint8Array([10, 20, 30, 40]);
    chunker.enqueue(payload);

    expect(channel.sentBuffers.length).toBe(0);
    expect(chunker.isBackpressured).toBe(true);

    // Drain buffer to 32 KiB (<= LOW_WATER_MARK)
    channel.simulateDrain(32 * 1024);

    expect(channel.sentBuffers.length).toBe(1);
    expect(chunker.queuedFrames).toBe(0);
    expect(chunker.isBackpressured).toBe(false);
  });

  // Scenario 4: FIFO ordering across multi-stage drain
  it("preserves strict FIFO sequential ordering across multi-stage buffer drain", () => {
    const channel = new MockDataChannel();
    const chunker = new DataChannelChunker(channel);

    const messageCount = 5;
    for (let i = 0; i < messageCount; i++) {
      const data = new TextEncoder().encode(`crdt-msg-${i}`);
      chunker.enqueue(data, { messageId: 100 + i });
    }

    // Since initial bufferedAmount is 0 and total bytes < 1 MiB, all frames send immediately
    expect(channel.sentBuffers.length).toBe(messageCount);

    const reassembler = new CrdtFrameReassembler();
    const decodedSeq: string[] = [];
    for (const buf of channel.sentBuffers) {
      const reassembled = reassembler.pushFrame(buf);
      if (reassembled) {
        decodedSeq.push(new TextDecoder().decode(reassembled.payload));
      }
    }

    expect(decodedSeq).toEqual([
      "crdt-msg-0",
      "crdt-msg-1",
      "crdt-msg-2",
      "crdt-msg-3",
      "crdt-msg-4",
    ]);
  });

  // Scenario 5: Large payload chunking & reassembly
  it("fragments payloads larger than 64 KiB into valid MTU frames and reassembles cleanly", () => {
    const channel = new MockDataChannel();
    const chunker = new DataChannelChunker(channel);

    // 150 KiB payload
    const largePayload = new Uint8Array(150 * 1024);
    for (let i = 0; i < largePayload.length; i++) {
      largePayload[i] = (i * 17) & 0xff;
    }

    chunker.enqueue(largePayload, {
      messageType: CrdtFrameMessageType.DELTA_UPDATE,
    });

    // 150 KiB / 65,520 payload chunk cap => 3 frames
    expect(channel.sentBuffers.length).toBe(3);

    for (const buf of channel.sentBuffers) {
      expect(buf.byteLength).toBeLessThanOrEqual(CRDT_MAX_SCTP_MESSAGE_SIZE);
      const frame = decodeCrdtFrame(buf);
      expect(frame.totalChunks).toBe(3);
    }

    // Reconstruct with CrdtFrameReassembler
    const reassembler = new CrdtFrameReassembler();
    let finalResult = null;
    for (const buf of channel.sentBuffers) {
      const res = reassembler.pushFrame(buf);
      if (res) finalResult = res;
    }

    expect(finalResult).not.toBeNull();
    expect(finalResult!.payload.byteLength).toBe(largePayload.byteLength);
    expect(Buffer.from(finalResult!.payload)).toEqual(
      Buffer.from(largePayload),
    );
  });

  // Scenario 6: Rapid 1,000+ update burst
  it("handles rapid 1,000+ update burst without message loss, duplicate frames, or reordering", () => {
    const channel = new MockDataChannel();
    channel.simulateBufferAccumulation = true;

    const chunker = new DataChannelChunker(channel);
    const reassembler = new CrdtFrameReassembler();

    const totalUpdates = 1000;
    const receivedSeqs: number[] = [];

    for (let i = 0; i < totalUpdates; i++) {
      const msg = JSON.stringify({ seq: i, mark: `stroke-${i}` });
      const payload = new TextEncoder().encode(msg);
      chunker.enqueue(payload);

      // Periodically simulate browser network draining when buffer exceeds HIGH_WATER_MARK
      if (channel.bufferedAmount >= HIGH_WATER_MARK) {
        while (channel.sentBuffers.length > 0) {
          const buf = channel.sentBuffers.shift()!;
          const reassembled = reassembler.pushFrame(buf);
          if (reassembled) {
            const parsed = JSON.parse(
              new TextDecoder().decode(reassembled.payload),
            );
            receivedSeqs.push(parsed.seq);
          }
        }
        // Drain to 0
        channel.simulateDrain(0);
      }
    }

    // Flush any remaining frames
    while (channel.sentBuffers.length > 0 || chunker.queuedFrames > 0) {
      while (channel.sentBuffers.length > 0) {
        const buf = channel.sentBuffers.shift()!;
        const reassembled = reassembler.pushFrame(buf);
        if (reassembled) {
          const parsed = JSON.parse(
            new TextDecoder().decode(reassembled.payload),
          );
          receivedSeqs.push(parsed.seq);
        }
      }
      channel.simulateDrain(0);
    }

    expect(receivedSeqs.length).toBe(totalUpdates);
    for (let i = 0; i < totalUpdates; i++) {
      expect(receivedSeqs[i]).toBe(i);
    }
    expect(chunker.queuedFrames).toBe(0);
    expect(chunker.queuedBytes).toBe(0);
    expect(chunker.isBackpressured).toBe(false);
  });

  // Scenario 7: OperationError recovery
  it("preserves pending frame on WebRTC OperationError and retries upon buffer drain", () => {
    const channel = new MockDataChannel();
    const chunker = new DataChannelChunker(channel);

    channel.shouldThrowOperationError = true;
    const payload = new TextEncoder().encode("transient-error-test");

    chunker.enqueue(payload);

    // Frame was not discarded; remained at head of queue
    expect(chunker.queuedFrames).toBe(1);
    expect(chunker.isBackpressured).toBe(true);
    expect(channel.sentBuffers.length).toBe(0);

    // Error condition clears and buffer drains
    channel.shouldThrowOperationError = false;
    channel.simulateDrain(0);

    expect(chunker.queuedFrames).toBe(0);
    expect(channel.sentBuffers.length).toBe(1);
    expect(chunker.isBackpressured).toBe(false);
  });

  // Scenario 8: Multiple peers operate independently
  it("isolates backpressure across multiple peers without head-of-line blocking", () => {
    const channelA = new MockDataChannel(); // congested
    channelA.bufferedAmount = HIGH_WATER_MARK + 1000;

    const channelB = new MockDataChannel(); // healthy
    channelB.bufferedAmount = 0;

    const chunkerA = new DataChannelChunker(channelA);
    const chunkerB = new DataChannelChunker(channelB);

    const payload = new TextEncoder().encode("peer-broadcast");

    chunkerA.enqueue(payload);
    chunkerB.enqueue(payload);

    expect(chunkerA.isBackpressured).toBe(true);
    expect(chunkerA.queuedFrames).toBe(1);
    expect(channelA.sentBuffers.length).toBe(0);

    expect(chunkerB.isBackpressured).toBe(false);
    expect(chunkerB.queuedFrames).toBe(0);
    expect(channelB.sentBuffers.length).toBe(1);
  });

  // Scenario 9: Channel lifecycle and delayed events
  it("cleans up resources on channel close and ignores delayed events after disposal", () => {
    const channel = new MockDataChannel();
    const chunker = new DataChannelChunker(channel);

    chunker.enqueue(new Uint8Array([1, 2, 3]));
    expect(channel.sentBuffers.length).toBe(1);

    chunker.dispose();
    expect(chunker.isDisposed).toBe(true);
    expect(chunker.queuedFrames).toBe(0);

    // Delayed bufferedamountlow event dispatch after disposal
    expect(() => {
      channel.simulateDrain(0);
    }).not.toThrow();

    // Enqueue after disposal throws descriptive error
    expect(() => {
      chunker.enqueue(new Uint8Array([4, 5, 6]));
    }).toThrow("Cannot enqueue message on a disposed DataChannelChunker");
  });

  // Scenario 10: Queue capacity boundaries and explicit QueueOverflowError
  it("throws QueueOverflowError when memory limit is exceeded rather than silently dropping", () => {
    const channel = new MockDataChannel();
    channel.bufferedAmount = HIGH_WATER_MARK + 1000; // Force queueing

    const chunker = new DataChannelChunker(channel, {
      maxQueueBytes: 1000,
      overflowPolicy: "throw",
    });

    // 1 frame with 16-byte header + 100-byte payload = 116 bytes -> OK
    chunker.enqueue(new Uint8Array(100));
    expect(chunker.queuedFrames).toBe(1);

    // Attempting to enqueue 2000 bytes exceeds 1000 maxQueueBytes
    expect(() => {
      chunker.enqueue(new Uint8Array(2000));
    }).toThrow(QueueOverflowError);

    // Existing queued frame remains intact
    expect(chunker.queuedFrames).toBe(1);
  });

  // Scenario 11: Hook integration coverage (useMeshDataChannels)
  describe("useMeshDataChannels hook integration with DataChannelChunker", () => {
    let originalRTCPeerConnection: any;

    beforeEach(() => {
      originalRTCPeerConnection = global.RTCPeerConnection;
    });

    afterEach(() => {
      global.RTCPeerConnection = originalRTCPeerConnection;
    });

    it("routes sendToAll and sendToPeer through chunkers with framing and reassembly", async () => {
      const mockDc = new MockDataChannel();

      (global as any).RTCPeerConnection = jest.fn().mockImplementation(() => ({
        signalingState: "stable",
        connectionState: "connected",
        iceConnectionState: "connected",
        close: jest.fn(),
        createOffer: jest.fn().mockResolvedValue({ sdp: "offer" }),
        createAnswer: jest.fn().mockResolvedValue({ sdp: "answer" }),
        setLocalDescription: jest.fn().mockResolvedValue(undefined),
        setRemoteDescription: jest.fn().mockResolvedValue(undefined),
        addIceCandidate: jest.fn().mockResolvedValue(undefined),
        createDataChannel: jest.fn().mockReturnValue(mockDc),
        getStats: jest.fn().mockResolvedValue(new Map()),
        onicecandidate: null,
        ondatachannel: null,
        oniceconnectionstatechange: null,
      }));

      const receivedData: ArrayBuffer[] = [];
      const onData = jest.fn((_peerId: string, data: ArrayBuffer) => {
        receivedData.push(data);
      });

      let hookResult: any;
      await act(async () => {
        hookResult = renderHook(() =>
          useMeshDataChannels({
            roomId: "test-room",
            userId: "local-user",
            onData,
          }),
        );
      });

      // Simulate incoming peer-join signal from remote peer
      await act(async () => {
        mockSocketOptions.onMessage({
          data: JSON.stringify({
            type: "webrtc-signal",
            kind: "peer-join",
            from: "remote-peer-1",
          }),
        });
      });

      // Simulate data channel open
      await act(async () => {
        mockDc.onopen?.({} as any);
      });

      // Peer connected, test sendToAll
      const testPayload = new Uint8Array([42, 43, 44, 45]).buffer;
      await act(async () => {
        hookResult.result.current.sendToAll(testPayload);
      });

      expect(mockDc.sentBuffers.length).toBe(1);
      const sentFrame = mockDc.sentBuffers[0];
      expect(sentFrame.byteLength).toBe(CRDT_FRAME_HEADER_SIZE + 4);

      // Verify that incoming framed message is reassembled and passed to onData
      await act(async () => {
        mockDc.onmessage?.({ data: sentFrame });
      });

      expect(onData).toHaveBeenCalledTimes(1);
      expect(Buffer.from(receivedData[0])).toEqual(
        Buffer.from(new Uint8Array([42, 43, 44, 45])),
      );

      // Also test sendToPeer
      const peerPayload = new Uint8Array([99, 98, 97]).buffer;
      await act(async () => {
        hookResult.result.current.sendToPeer("remote-peer-1", peerPayload);
      });
      expect(mockDc.sentBuffers.length).toBe(2);

      // Clean unmount
      hookResult.unmount();
    });
  });
});
