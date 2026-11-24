/**
 * @jest-environment node
 */

import {
  MeshBloomFilter,
  MAX_MEMORY_FOOTPRINT_BYTES,
  CRDT_FRAME_MAGIC,
} from "@/lib/p2p/meshBloomFilter";

describe("MeshBloomFilter Unit Tests", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Acceptance Criteria: False Positive Rate under 5,000 messages", () => {
    it("achieves < 0.1% false positive probability under 5000 messages", () => {
      const filter = new MeshBloomFilter({
        capacity: 5000,
        targetFpr: 0.001,
        autoRotate: false,
      });

      // Insert 5000 unique keys
      for (let i = 0; i < 5000; i++) {
        filter.add(`msg-key-${i}-batch-alpha`);
      }

      // Query 10,000 distinct unseen keys
      let falsePositives = 0;
      const testCount = 10000;
      for (let i = 0; i < testCount; i++) {
        if (filter.has(`unseen-key-${i}-batch-beta`)) {
          falsePositives++;
        }
      }

      const empiricalFpr = falsePositives / testCount;
      // Must be strictly below 0.1% (0.001)
      expect(empiricalFpr).toBeLessThan(0.001);
    });
  });

  describe("Acceptance Criteria: Memory footprint strictly bounded to under 128KB", () => {
    it("bounds total dual-generation bitset memory under 128 KB", () => {
      const filter = new MeshBloomFilter({
        capacity: 5000,
        targetFpr: 0.001,
        autoRotate: false,
      });

      const metrics = filter.getMetrics();
      // Total dual-bitset size
      expect(metrics.memorySizeBytes).toBeLessThan(MAX_MEMORY_FOOTPRINT_BYTES);
      expect(metrics.memorySizeBytes).toBeLessThan(128 * 1024);
      // For 5000 items at 0.1% FPR, dual-bitset is ~18 KB (well within budget)
      expect(metrics.memorySizeBytes).toBeLessThan(32 * 1024);
    });

    it("throws error if configuration exceeds 128KB memory limit", () => {
      expect(() => {
        // Requesting 10 million items with 1e-9 FPR will exceed 128KB
        new MeshBloomFilter({
          capacity: 10_000_000,
          targetFpr: 1e-9,
          autoRotate: false,
        });
      }).toThrow(/exceeds memory budget/);
    });
  });

  describe("Acceptance Criteria: Instant O(1) duplicate rejection with testAndAdd", () => {
    it("returns false on first insertion and true on duplicate insertions", () => {
      const filter = new MeshBloomFilter({ autoRotate: false });

      const msgId = "peer-msg-48912";
      expect(filter.has(msgId)).toBe(false);

      // First time seen: should return false (not duplicate)
      const isDuplicateFirst = filter.testAndAdd(msgId);
      expect(isDuplicateFirst).toBe(false);

      // Now it must be present
      expect(filter.has(msgId)).toBe(true);

      // Second time seen: should return true (is duplicate)
      const isDuplicateSecond = filter.testAndAdd(msgId);
      expect(isDuplicateSecond).toBe(true);
    });

    it("supports string, number, and binary Uint8Array keys", () => {
      const filter = new MeshBloomFilter({ autoRotate: false });

      // Number key
      expect(filter.testAndAdd(12345678)).toBe(false);
      expect(filter.testAndAdd(12345678)).toBe(true);

      // String key
      expect(filter.testAndAdd("gossip-uuid-abc")).toBe(false);
      expect(filter.testAndAdd("gossip-uuid-abc")).toBe(true);

      // Uint8Array key
      const binaryKey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(filter.testAndAdd(binaryKey)).toBe(false);
      expect(filter.testAndAdd(binaryKey)).toBe(true);
    });
  });

  describe("Generational Rotation Every 60 Seconds", () => {
    it("automatically rotates bitsets every 60 seconds", () => {
      const filter = new MeshBloomFilter({
        capacity: 1000,
        rotationIntervalMs: 60_000,
        autoRotate: true,
      });

      expect(filter.getMetrics().rotationsCount).toBe(0);

      jest.advanceTimersByTime(60_000);
      expect(filter.getMetrics().rotationsCount).toBe(1);

      jest.advanceTimersByTime(60_000);
      expect(filter.getMetrics().rotationsCount).toBe(2);

      filter.destroy();
    });

    it("retains items from previous generation and evicts items older than 2 rotations", () => {
      const filter = new MeshBloomFilter({ autoRotate: false });

      filter.add("msg-generation-0");
      expect(filter.has("msg-generation-0")).toBe(true);

      // First rotation: msg-generation-0 moves to previous generation
      filter.rotate();
      expect(filter.has("msg-generation-0")).toBe(true);

      filter.add("msg-generation-1");
      expect(filter.has("msg-generation-0")).toBe(true);
      expect(filter.has("msg-generation-1")).toBe(true);

      // Second rotation: msg-generation-0 is evicted, msg-generation-1 moves to previous
      filter.rotate();
      expect(filter.has("msg-generation-0")).toBe(false);
      expect(filter.has("msg-generation-1")).toBe(true);
    });

    it("adaptively rotates when capacity is exceeded before 60 seconds", () => {
      const filter = new MeshBloomFilter({ capacity: 50, autoRotate: false });

      for (let i = 0; i < 50; i++) {
        filter.add(`burst-msg-${i}`);
      }
      expect(filter.getMetrics().rotationsCount).toBe(0);

      // 51st item exceeds capacity, triggering adaptive rotation
      filter.add("burst-msg-50");
      expect(filter.getMetrics().rotationsCount).toBe(1);
      expect(filter.has("burst-msg-0")).toBe(true);
      expect(filter.has("burst-msg-50")).toBe(true);
    });
  });

  describe("Fast Wire Message ID Extraction", () => {
    it("extracts uint32 messageId from framed CRDT payloads (magic 0x5753)", () => {
      const filter = new MeshBloomFilter({ autoRotate: false });

      // Build 16-byte framed header
      const buffer = new ArrayBuffer(20);
      const view = new DataView(buffer);
      view.setUint16(0, CRDT_FRAME_MAGIC, false); // Magic 0x5753
      view.setUint8(2, 1); // Version
      view.setUint8(3, 0); // Flags
      view.setUint32(4, 987654, false); // messageId = 987654

      const extractedId = filter.extractMessageId(buffer);
      expect(extractedId).toBe("crdt:987654");
    });

    it("computes fast fingerprint for raw binary buffers", () => {
      const filter = new MeshBloomFilter({ autoRotate: false });

      const buf1 = new Uint8Array([10, 20, 30, 40, 50]).buffer;
      const buf2 = new Uint8Array([10, 20, 30, 40, 50]).buffer;
      const buf3 = new Uint8Array([10, 20, 30, 40, 51]).buffer;

      const id1 = filter.extractMessageId(buf1);
      const id2 = filter.extractMessageId(buf2);
      const id3 = filter.extractMessageId(buf3);

      expect(id1).toBe(id2);
      expect(id1).not.toBe(id3);
    });

    it("extracts identical invariant messageId from GossipSub Publish packets even when hop count increments", () => {
      const filter = new MeshBloomFilter({ autoRotate: false });

      // Construct a mock GossipSub Publish packet (>= 113 bytes)
      const packetHop1 = new Uint8Array(120);
      packetHop1[0] = 1; // version
      packetHop1[1] = 1; // publish
      packetHop1[2] = 1; // hops = 1
      packetHop1[3] = 4; // topic length
      // Set Ed25519 origin signature in the final 64 bytes
      for (let i = 120 - 64; i < 120; i++) {
        packetHop1[i] = (i * 17) % 256;
      }

      // Relay forwards the same packet with hops incremented to 2
      const packetHop2 = new Uint8Array(packetHop1);
      packetHop2[2] = 2; // hops = 2

      const idHop1 = filter.extractMessageId(packetHop1);
      const idHop2 = filter.extractMessageId(packetHop2);

      expect(idHop1).toBe(idHop2);
      expect(filter.testAndAdd(idHop1)).toBe(false);
      // Forwarded relay packet is dropped as duplicate in O(1)
      expect(filter.testAndAdd(idHop2)).toBe(true);
    });
  });
});
