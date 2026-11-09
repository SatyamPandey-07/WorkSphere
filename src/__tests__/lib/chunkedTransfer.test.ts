import {
  P2P_CHUNK_SIZE,
  sliceFileChunk,
  waitForBufferedAmountLow,
  computeSHA256,
  computeFileSHA256,
  serializeBinaryChunkPacket,
  deserializeBinaryChunkPacket,
  formatThroughput,
  formatETA,
} from "@/lib/p2p/chunkedTransfer";

describe("P2P Chunked Transfer Engine (#5812)", () => {
  it("enforces 64KB chunk size constant", () => {
    expect(P2P_CHUNK_SIZE).toBe(64 * 1024);
    expect(P2P_CHUNK_SIZE).toBe(65536);
  });

  it("slices files into exact 64KB ArrayBuffer chunks", async () => {
    // Create a 150KB mock file (> 2 chunks of 64KB)
    const totalBytes = 150 * 1024;
    const buffer = new Uint8Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) {
      buffer[i] = i % 256;
    }
    const file = new File([buffer], "large-document.bin", {
      type: "application/octet-stream",
    });

    const chunk0 = await sliceFileChunk(file, 0);
    expect(chunk0.byteLength).toBe(64 * 1024);

    const chunk1 = await sliceFileChunk(file, 1);
    expect(chunk1.byteLength).toBe(64 * 1024);

    // Final chunk has remainder (150KB - 128KB = 22KB = 22528 bytes)
    const chunk2 = await sliceFileChunk(file, 2);
    expect(chunk2.byteLength).toBe(22 * 1024);
  });

  it("monitors backpressure and drains when bufferedAmount exceeds threshold", async () => {
    let lowListener: (() => void) | null = null;
    const mockChannel = {
      bufferedAmount: 128 * 1024,
      bufferedAmountLowThreshold: 0,
      addEventListener: jest.fn((event: string, handler: () => void) => {
        if (event === "bufferedamountlow") {
          lowListener = handler;
        }
      }),
      removeEventListener: jest.fn(),
    } as unknown as RTCDataChannel;

    let drained = false;
    const waitPromise = waitForBufferedAmountLow(mockChannel, 64 * 1024).then(
      () => {
        drained = true;
      },
    );

    expect(mockChannel.bufferedAmountLowThreshold).toBe(64 * 1024);
    expect(drained).toBe(false);

    // Simulate channel buffer draining below threshold
    if (lowListener) {
      (mockChannel as unknown as { bufferedAmount: number }).bufferedAmount =
        32 * 1024;
      (lowListener as () => void)();
    }

    await waitPromise;
    expect(drained).toBe(true);
    expect(mockChannel.removeEventListener).toHaveBeenCalledWith(
      "bufferedamountlow",
      expect.any(Function),
    );
  });

  it("does not wait if bufferedAmount is already below threshold", async () => {
    const mockChannel = {
      bufferedAmount: 16 * 1024,
      bufferedAmountLowThreshold: 0,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    } as unknown as RTCDataChannel;

    await waitForBufferedAmountLow(mockChannel, 64 * 1024);
    expect(mockChannel.addEventListener).not.toHaveBeenCalled();
  });

  it("computes SHA-256 hash and verifies integrity", async () => {
    const data = new TextEncoder().encode("Hello WorkSphere P2P Chunking");
    const hash1 = await computeSHA256(data);
    const hash2 = await computeSHA256(data);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    const file = new File([data], "test.txt", { type: "text/plain" });
    const fileHash = await computeFileSHA256(file);
    expect(fileHash).toBe(hash1);
  });

  it("serializes and deserializes binary chunk packets without corruption", () => {
    const chunkData = new Uint8Array([10, 20, 30, 40, 50]).buffer;
    const transferId = "test-transfer-id-123";
    const chunkIndex = 4;
    const totalChunks = 10;

    const packet = serializeBinaryChunkPacket(
      transferId,
      chunkIndex,
      totalChunks,
      chunkData,
    );
    expect(packet).toBeInstanceOf(ArrayBuffer);

    const unpacked = deserializeBinaryChunkPacket(packet);
    expect(unpacked).not.toBeNull();
    expect(unpacked?.transferId).toBe(transferId);
    expect(unpacked?.chunkIndex).toBe(chunkIndex);
    expect(unpacked?.totalChunks).toBe(totalChunks);
    expect(Array.from(unpacked!.chunkData)).toEqual([10, 20, 30, 40, 50]);
  });

  it("formats throughput and ETA accurately", () => {
    expect(formatThroughput(2.45)).toBe("2.5 MB/s");
    expect(formatThroughput(0.5)).toBe("512 KB/s");

    expect(formatETA(0)).toBe("< 1s");
    expect(formatETA(15)).toBe("15s");
    expect(formatETA(75)).toBe("1m 15s");
  });
});
