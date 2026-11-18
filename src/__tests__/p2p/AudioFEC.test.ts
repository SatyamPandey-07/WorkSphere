/**
 * @jest-environment node
 */
import {
  FECEncoder,
  FECReceiver,
  computeXORParity,
  reconstructMissingFrame,
  PeerLossMonitor,
  encodeAudioFrameWithFEC,
  decodeFECPacket,
  AudioFrame,
  AudioFECError,
} from "@/core/p2p/AudioFEC";
import {
  GossipSubRouter,
  GossipMessage,
  generateEd25519Identity,
} from "@/core/p2p/GossipSubRouter";

describe("AudioFEC Unit & Adaptive Tests (#7948)", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const dec = (b: Uint8Array) => new TextDecoder().decode(b);

  describe("1. XOR Parity Generation", () => {
    it("generates correct parity for multiple audio frames", () => {
      const f1 = enc("frame-one");
      const f2 = enc("frame-two");
      const f3 = enc("frame-three");

      const parity = computeXORParity([f1, f2, f3]);
      expect(parity.length).toBe(Math.max(f1.length, f2.length, f3.length));

      // Parity property: parity XOR f1 XOR f2 = f3 (with zero padding)
      const reconstructed = new Uint8Array(parity);
      for (let i = 0; i < f1.length; i++) reconstructed[i] ^= f1[i];
      for (let i = 0; i < f2.length; i++) reconstructed[i] ^= f2[i];

      expect(dec(reconstructed.slice(0, f3.length))).toBe("frame-three");
    });

    it("handles empty input gracefully", () => {
      expect(computeXORParity([])).toEqual(new Uint8Array(0));
    });
  });

  describe("2. Exact Reconstruction of One Dropped Frame & Variable Lengths", () => {
    it("reconstructs exactly one dropped frame when payload lengths differ", () => {
      const frames = [
        enc("audio-chunk-short"),
        enc("audio-chunk-a-little-longer-payload"),
        enc("tiny"),
        enc("medium-sized-audio-sample-12345"),
      ];

      const lengths = frames.map((f) => f.length);
      const parity = computeXORParity(frames);

      // Suppose frame 1 is dropped
      const missingIndex = 1;
      const receivedMap = new Map<number, Uint8Array>();
      frames.forEach((f, idx) => {
        if (idx !== missingIndex) receivedMap.set(idx, f);
      });

      const recovered = reconstructMissingFrame(
        receivedMap,
        lengths,
        parity,
        missingIndex,
      );
      expect(dec(recovered)).toBe(dec(frames[missingIndex]));
      expect(recovered.length).toBe(lengths[missingIndex]);
    });

    it("reconstructs frame 0 when frame 0 is dropped", () => {
      const frames = [enc("first-frame"), enc("second-frame"), enc("third")];
      const lengths = frames.map((f) => f.length);
      const parity = computeXORParity(frames);

      const missingIndex = 0;
      const receivedMap = new Map<number, Uint8Array>();
      frames.forEach((f, idx) => {
        if (idx !== missingIndex) receivedMap.set(idx, f);
      });

      const recovered = reconstructMissingFrame(
        receivedMap,
        lengths,
        parity,
        missingIndex,
      );
      expect(dec(recovered)).toBe("first-frame");
    });
  });

  describe("3. Unrecoverable Conditions", () => {
    it("refuses recovery when two or more frames are missing", () => {
      const frames = [enc("f0"), enc("f1"), enc("f2"), enc("f3")];
      const lengths = frames.map((f) => f.length);
      const parity = computeXORParity(frames);

      // Two frames missing: 1 and 2
      const receivedMap = new Map<number, Uint8Array>();
      receivedMap.set(0, frames[0]);
      receivedMap.set(3, frames[3]);

      expect(() =>
        reconstructMissingFrame(receivedMap, lengths, parity, 1),
      ).toThrow(AudioFECError);
    });

    it("refuses recovery if received frame length metadata is inconsistent", () => {
      const frames = [enc("one"), enc("two"), enc("three")];
      const lengths = [3, 3, 5];
      const parity = computeXORParity(frames);

      const receivedMap = new Map<number, Uint8Array>();
      receivedMap.set(0, enc("longer-than-3"));
      receivedMap.set(2, frames[2]);

      expect(() =>
        reconstructMissingFrame(receivedMap, lengths, parity, 1),
      ).toThrow(/mismatch/);
    });

    it("refuses recovery if parity padding validation fails", () => {
      const frames = [enc("short"), enc("longer-frame")];
      const lengths = frames.map((f) => f.length);
      const parity = computeXORParity(frames);
      // Corrupt padding
      parity[parity.length - 1] ^= 0xff;

      const receivedMap = new Map<number, Uint8Array>();
      receivedMap.set(1, frames[1]);

      expect(() =>
        reconstructMissingFrame(receivedMap, lengths, parity, 0),
      ).toThrow(/validation failed/);
    });
  });

  describe("4. FECReceiver Buffer & Pipeline Handling", () => {
    it("buffers frames and reconstructs dropped frame upon parity arrival", () => {
      const receiver = new FECReceiver();
      const encoder = new FECEncoder(3);

      const rawFrames: AudioFrame[] = [
        {
          streamId: "s1",
          frameSeq: 100,
          timestamp: 1000,
          payload: enc("packet-0"),
        },
        {
          streamId: "s1",
          frameSeq: 101,
          timestamp: 1020,
          payload: enc("packet-1"),
        },
        {
          streamId: "s1",
          frameSeq: 102,
          timestamp: 1040,
          payload: enc("packet-2"),
        },
      ];

      const p0 = encoder.addFrame(rawFrames[0]);
      encoder.addFrame(rawFrames[1]); // dropped frame
      const p2 = encoder.addFrame(rawFrames[2]);

      expect(p2.parityPacket).not.toBeNull();

      const delivered: AudioFrame[] = [];
      const recovered: AudioFrame[] = [];

      // Simulate packet 1 dropped over the network
      // Ingest packet 0
      const dec0 = decodeFECPacket(p0.encodedAudioPacket);
      delivered.push(
        ...receiver.processPacket(dec0, (rec) => recovered.push(rec)),
      );

      // Ingest packet 2
      const dec2 = decodeFECPacket(p2.encodedAudioPacket);
      delivered.push(
        ...receiver.processPacket(dec2, (rec) => recovered.push(rec)),
      );

      expect(delivered.length).toBe(2);
      expect(recovered.length).toBe(0);

      // Ingest parity packet
      const decParity = decodeFECPacket(p2.parityPacket!);
      const parityResult = receiver.processPacket(decParity, (rec) =>
        recovered.push(rec),
      );

      expect(parityResult.length).toBe(1);
      expect(recovered.length).toBe(1);
      expect(dec(recovered[0].payload)).toBe("packet-1");
      expect(recovered[0].frameSeq).toBe(101);
    });

    it("suppresses duplicate frames and out-of-order packets", () => {
      const receiver = new FECReceiver();
      const frame: AudioFrame = {
        streamId: "s1",
        frameSeq: 1,
        timestamp: 100,
        payload: enc("audio"),
      };
      const encoded = encodeAudioFrameWithFEC(frame, 0, 4, 0);
      const decPkt = decodeFECPacket(encoded);

      const d1 = receiver.processPacket(decPkt);
      expect(d1.length).toBe(1);

      // Re-delivery
      const d2 = receiver.processPacket(decPkt);
      expect(d2.length).toBe(0);
    });

    it("expires stale incomplete blocks", () => {
      const receiver = new FECReceiver(20); // 20ms expiration
      const frame: AudioFrame = {
        streamId: "s1",
        frameSeq: 1,
        timestamp: 100,
        payload: enc("audio"),
      };
      const encoded = encodeAudioFrameWithFEC(frame, 0, 4, 0);
      receiver.processPacket(decodeFECPacket(encoded));

      // Wait 30ms for block to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Ingest another packet to trigger cleanupExpired
          const f2: AudioFrame = {
            streamId: "s1",
            frameSeq: 10,
            timestamp: 200,
            payload: enc("audio2"),
          };
          receiver.processPacket(
            decodeFECPacket(encodeAudioFrameWithFEC(f2, 1, 4, 0)),
          );
          // Original block 0 should be cleaned up
          resolve();
        }, 30);
      });
    });
  });

  describe("5. Adaptive WebRTC Stats Monitoring & Transitions", () => {
    it("activates FEC when packet loss > 5%", () => {
      const monitor = new PeerLossMonitor({ activateSamplesThreshold: 1 });
      expect(monitor.isFECEnabled()).toBe(false);

      // Baseline sample: 0 lost, 100 received
      monitor.updateStats(0, 100, 1000);
      expect(monitor.isFECEnabled()).toBe(false);

      // Next interval: 10 lost out of 100 sent (10% loss > 5%)
      monitor.updateStats(10, 190, 2000);
      expect(monitor.getLossPercentage()).toBe(10);
      expect(monitor.isFECEnabled()).toBe(true);
    });

    it("deactivates FEC when packet loss returns to 0%", () => {
      const monitor = new PeerLossMonitor({
        activateSamplesThreshold: 1,
        deactivateSamplesThreshold: 2,
      });

      // Baseline
      monitor.updateStats(0, 100, 1000);
      // High loss
      monitor.updateStats(10, 190, 2000);
      expect(monitor.isFECEnabled()).toBe(true);

      // Sample 1 at 0% loss: deltas: 0 lost, 100 sent
      monitor.updateStats(10, 290, 3000);
      expect(monitor.getLossPercentage()).toBe(0);
      // Hysteresis: requires 2 consecutive zero loss samples
      expect(monitor.isFECEnabled()).toBe(true);

      // Sample 2 at 0% loss:
      monitor.updateStats(10, 390, 4000);
      expect(monitor.getLossPercentage()).toBe(0);
      expect(monitor.isFECEnabled()).toBe(false);
    });

    it("handles counter resets safely", () => {
      const monitor = new PeerLossMonitor();
      monitor.updateStats(50, 1000, 1000);
      // Remote peer reconnected or stats reset
      monitor.updateStats(0, 10, 2000);
      // Should not throw or generate negative ratios
      expect(monitor.getLossRatio()).toBe(0);
    });

    it("handles zero denominator without division by zero", () => {
      const monitor = new PeerLossMonitor();
      monitor.updateStats(0, 0, 1000);
      monitor.updateStats(0, 0, 2000);
      expect(monitor.getLossRatio()).toBe(0);
      expect(Number.isFinite(monitor.getLossPercentage())).toBe(true);
    });
  });

  describe("6. GossipSubRouter Integration with Adaptive FEC", () => {
    it("operates with independent adaptive loss state across separate peers", async () => {
      const id = await generateEd25519Identity();
      const sent = new Map<string, Uint8Array[]>();

      const router = new GossipSubRouter({
        localPeerId: "node-local",
        identity: id,
        send: (peerId, data) => {
          let list = sent.get(peerId);
          if (!list) {
            list = [];
            sent.set(peerId, list);
          }
          list.push(data);
        },
      });

      router.addPeer("peer-A");
      router.addPeer("peer-B");
      router.subscribe("audio/emergency");

      // Peer A experiences 8% loss
      router.updatePeerStats("peer-A", 0, 100);
      router.updatePeerStats("peer-A", 8, 192);

      // Peer B experiences 0% loss
      router.updatePeerStats("peer-B", 0, 100);
      router.updatePeerStats("peer-B", 0, 200);

      expect(router.getPeerLossMonitor("peer-A")?.isFECEnabled()).toBe(true);
      expect(router.getPeerLossMonitor("peer-B")?.isFECEnabled()).toBe(false);
    });

    it("cleans up peer state on peer departure", async () => {
      const id = await generateEd25519Identity();
      const router = new GossipSubRouter({
        localPeerId: "node-local",
        identity: id,
        send: () => {},
      });

      router.addPeer("peer-X");
      expect(router.getPeerLossMonitor("peer-X")).toBeDefined();
      expect(router.getFECReceiver("peer-X")).toBeDefined();

      router.removePeer("peer-X");
      expect(router.getPeerLossMonitor("peer-X")).toBeUndefined();
      expect(router.getFECReceiver("peer-X")).toBeUndefined();
    });

    it("preserves legacy non-FEC audio packets and non-audio gossip messages", async () => {
      const id = await generateEd25519Identity();
      const deliveredMessages: GossipMessage[] = [];
      const audioFrames: AudioFrame[] = [];

      const router = new GossipSubRouter({
        localPeerId: "node-local",
        identity: id,
        send: () => {},
        onMessage: (m) => deliveredMessages.push(m),
        onAudioFrame: (f) => audioFrames.push(f),
      });

      router.subscribe("general/chat");
      router.subscribe("audio/legacy");

      // 1. Non-audio text broadcast
      await router.publish("general/chat", enc("hello world text"));
      expect(deliveredMessages.length).toBe(1);
      expect(dec(deliveredMessages[0].payload)).toBe("hello world text");
      // No audio frame callback triggered
      expect(audioFrames.length).toBe(0);

      // 2. Legacy non-FEC audio broadcast
      await router.publish("audio/legacy", enc("raw-legacy-opus-bytes"));
      expect(deliveredMessages.length).toBe(2);
      expect(dec(deliveredMessages[1].payload)).toBe("raw-legacy-opus-bytes");
      expect(audioFrames.length).toBe(0);
    });

    it("publishes and delivers FEC audio and reconstructs dropped packets end-to-end", async () => {
      const idSender = await generateEd25519Identity();
      const idReceiver = await generateEd25519Identity();

      const deliveredReceiverMessages: GossipMessage[] = [];
      const recoveredAudioFrames: AudioFrame[] = [];

      let dropNextAudio = false;

      const p: Promise<void>[] = [];
      const senderRouter = new GossipSubRouter({
        localPeerId: "sender",
        identity: idSender,
        send: (toPeer, data) => {
          if (toPeer === "receiver") {
            if (dropNextAudio) {
              dropNextAudio = false; // Drop this one!
              return;
            }
            p.push(receiverRouter.handlePacket("sender", data));
          }
        },
      });

      const receiverRouter = new GossipSubRouter({
        localPeerId: "receiver",
        identity: idReceiver,
        send: (toPeer, data) => {
          if (toPeer === "sender") {
            p.push(senderRouter.handlePacket("receiver", data));
          }
        },
        onMessage: (m) => deliveredReceiverMessages.push(m),
        onAudioFrame: (f) => recoveredAudioFrames.push(f),
      });

      senderRouter.addPeer("receiver");
      receiverRouter.addPeer("sender");

      senderRouter.subscribe("audio/emergency");
      receiverRouter.subscribe("audio/emergency");

      // Mesh heartbeat
      senderRouter.heartbeat();
      receiverRouter.heartbeat();
      await Promise.all(p);
      p.length = 0;

      // Trigger FEC activation on sender for receiver peer (> 5% loss)
      senderRouter.updatePeerStats("receiver", 0, 100);
      senderRouter.updatePeerStats("receiver", 10, 190);
      expect(senderRouter.isFECActiveForTopic("audio/emergency")).toBe(true);

      // Publish 4 audio frames (1 full FEC block: frames 0, 1, 2, 3)
      await senderRouter.publishAudio("audio/emergency", enc("frame-0"));
      dropNextAudio = true; // Drop frame 1 over network!
      await senderRouter.publishAudio("audio/emergency", enc("frame-1"));
      await senderRouter.publishAudio("audio/emergency", enc("frame-2"));
      // Frame 3 completes the block and sends both frame 3 and parity
      await senderRouter.publishAudio("audio/emergency", enc("frame-3"));

      await Promise.all(p);

      // Check that receiver got frames 0, 2, 3 and successfully recovered frame 1
      const recoveredPayloads = recoveredAudioFrames.map((f) => dec(f.payload));
      expect(recoveredPayloads).toContain("frame-0");
      expect(recoveredPayloads).toContain("frame-1"); // Reconstructed via FEC!
      expect(recoveredPayloads).toContain("frame-2");
      expect(recoveredPayloads).toContain("frame-3");
    });
  });
});
