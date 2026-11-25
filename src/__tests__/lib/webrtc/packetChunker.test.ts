import {
  DEFAULT_CHUNK_SIZE,
  HEADER_SIZE,
  PACKET_MAGIC_HEADER,
  PacketChunkerError,
  PacketReassembler,
  computeCRC32,
  isChunkedPacket,
  parseChunkHeader,
  splitIntoChunks,
} from "@/lib/webrtc/packetChunker";

describe("WebRTC DataChannel Packet Fragmentation & Reassembly (#7981)", () => {
  const createMockPayload = (sizeBytes: number): Uint8Array => {
    const buffer = new Uint8Array(sizeBytes);
    for (let i = 0; i < sizeBytes; i++) {
      buffer[i] = (i * 31 + 17) & 0xff;
    }
    return buffer;
  };

  it("calculates standard IEEE 802.3 CRC32 checksum accurately", () => {
    // Known check vector for ASCII "123456789"
    const standardVector = new TextEncoder().encode("123456789");
    const crc = computeCRC32(standardVector);
    expect(crc).toBe(0xcbf43926);

    // Empty array CRC32 is 0
    expect(computeCRC32(new Uint8Array(0))).toBe(0);
  });

  it("identifies chunked packets by magic header", () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5]);
    expect(isChunkedPacket(raw)).toBe(false);

    const chunk = new Uint8Array(HEADER_SIZE + 10);
    chunk.set(PACKET_MAGIC_HEADER, 0);
    expect(isChunkedPacket(chunk)).toBe(true);
  });

  it("splits a large payload into sequenced chunks with correct metadata", () => {
    const payload = createMockPayload(64 * 1024); // 64 KB
    const chunkSize = 16 * 1024; // 16 KB

    const chunks = splitIntoChunks(payload, { chunkSize });
    const expectedChunkCount = Math.ceil(payload.length / (chunkSize - HEADER_SIZE));

    expect(chunks.length).toBe(expectedChunkCount);

    for (let i = 0; i < chunks.length; i++) {
      const parsed = parseChunkHeader(chunks[i]);
      expect(parsed).not.toBeNull();
      expect(parsed!.header.chunkIndex).toBe(i);
      expect(parsed!.header.totalChunks).toBe(expectedChunkCount);
      expect(parsed!.header.totalLength).toBe(payload.length);
      expect(parsed!.header.checksum).toBe(computeCRC32(payload));
    }
  });

  it("handles empty payloads gracefully", () => {
    const empty = new Uint8Array(0);
    const chunks = splitIntoChunks(empty);
    expect(chunks.length).toBe(1);

    const reassembler = new PacketReassembler();
    const result = reassembler.push(chunks[0]);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(0);
  });

  it("rejects payloads exceeding the configured maxMessageSize", () => {
    const oversized = new Uint8Array(1024);
    expect(() =>
      splitIntoChunks(oversized, { maxMessageSize: 512 }),
    ).toThrow(PacketChunkerError);
  });

  it("reassembles in-order chunks into identical binary buffer", () => {
    const payload = createMockPayload(120 * 1024); // 120 KB
    const chunks = splitIntoChunks(payload, { chunkSize: 8 * 1024 });

    const reassembler = new PacketReassembler();
    let reconstructed: Uint8Array | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const result = reassembler.push(chunks[i]);
      if (i < chunks.length - 1) {
        expect(result).toBeNull();
      } else {
        reconstructed = result;
      }
    }

    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.length).toBe(payload.length);
    expect(Array.from(reconstructed!)).toEqual(Array.from(payload));
  });

  it("reassembles out-of-order and reversed chunks correctly", () => {
    const payload = createMockPayload(90 * 1024); // 90 KB
    const chunks = splitIntoChunks(payload, { chunkSize: 16 * 1024 });

    // Reverse chunk arrival order
    const reversed = [...chunks].reverse();

    const reassembler = new PacketReassembler();
    let reconstructed: Uint8Array | null = null;

    for (const chunk of reversed) {
      const res = reassembler.push(chunk);
      if (res) {
        reconstructed = res;
      }
    }

    expect(reconstructed).not.toBeNull();
    expect(Array.from(reconstructed!)).toEqual(Array.from(payload));
    expect(reassembler.getPendingMessageCount()).toBe(0);
  });

  it("passes unchunked raw buffers through immediately", () => {
    const rawBuffer = new TextEncoder().encode("direct-webrtc-raw-message");
    const reassembler = new PacketReassembler();

    const result = reassembler.push(rawBuffer);
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result!)).toBe("direct-webrtc-raw-message");
  });

  it("detects and rejects corrupted chunks with CRC32 checksum mismatch", () => {
    const payload = createMockPayload(32 * 1024);
    const chunks = splitIntoChunks(payload, { chunkSize: 8 * 1024 });

    // Tamper with payload byte in the second chunk
    chunks[1][HEADER_SIZE + 5] ^= 0xff;

    let corruptedReason = "";
    const reassembler = new PacketReassembler({
      onCorrupted: (_id, reason) => {
        corruptedReason = reason;
      },
    });

    let reconstructed: Uint8Array | null = null;
    for (const chunk of chunks) {
      const res = reassembler.push(chunk);
      if (res) reconstructed = res;
    }

    expect(reconstructed).toBeNull();
    expect(corruptedReason).toContain("CRC32 checksum mismatch");
  });

  it("sweeps and purges abandoned in-flight messages past timeout", () => {
    let mockTime = 1000;
    const reassembler = new PacketReassembler({
      chunkTimeoutMs: 5000,
      now: () => mockTime,
    });

    const payload = createMockPayload(50 * 1024);
    const chunks = splitIntoChunks(payload, { chunkSize: 16 * 1024 });

    // Send only chunk 0 and 1 (leaving message incomplete)
    reassembler.push(chunks[0]);
    reassembler.push(chunks[1]);
    expect(reassembler.getPendingMessageCount()).toBe(1);

    // Advance time before timeout
    mockTime += 3000;
    expect(reassembler.sweepStale()).toBe(0);
    expect(reassembler.getPendingMessageCount()).toBe(1);

    // Advance time past timeout threshold
    mockTime += 3000; // total +6000ms > 5000ms
    expect(reassembler.sweepStale()).toBe(1);
    expect(reassembler.getPendingMessageCount()).toBe(0);
  });
});
