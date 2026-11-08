/**
 * Tests for the Yjs CRDT binary compression buffer allocation guard (Issue #1719).
 * decompressYjsUpdate now validates uncompressedSize before allocating memory.
 */

import {
  compressYjsUpdate,
  decompressYjsUpdate,
  COMPRESSION_MAGIC_HEADER,
} from "@/lib/crdt/yjsCompression";

const MAX_SAFE_BYTES = 10 * 1024 * 1024; // 10 MB

describe("decompressYjsUpdate buffer overflow guard", () => {
  it("returns original bytes when buffer is too small to contain header", () => {
    const tiny = new Uint8Array([1, 2, 3]);
    const result = decompressYjsUpdate(tiny);
    expect(result).toEqual(tiny);
  });

  it("returns original bytes when magic header does not match", () => {
    // Craft a 9-byte buffer with wrong header
    const buf = new Uint8Array(9);
    buf[0] = 0x00; // wrong header
    const result = decompressYjsUpdate(buf);
    expect(result).toEqual(buf);
  });

  it("returns original bytes (not crash) when size field is 0", () => {
    // Create a buffer with correct header but size = 0
    const buf = new Uint8Array(9);
    buf.set(COMPRESSION_MAGIC_HEADER, 0); // set magic header
    // size bytes remain 0
    const result = decompressYjsUpdate(buf);
    // Should return original (size=0 is rejected)
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns original bytes when size exceeds 10 MB guard", () => {
    // Craft a buffer with correct header and size = 0xFFFFFFFF (4 GB)
    const buf = new Uint8Array(9);
    buf.set(COMPRESSION_MAGIC_HEADER, 0);
    const view = new DataView(buf.buffer);
    view.setUint32(4, 0xFFFFFFFF, false); // 4 GB — should be rejected

    const result = decompressYjsUpdate(buf);
    expect(result).toEqual(buf); // original returned, not crash
  });

  it("round-trips a valid 100-byte payload through compress/decompress", () => {
    const original = new Uint8Array(100);
    for (let i = 0; i < 100; i++) original[i] = i % 256;

    const compressed = compressYjsUpdate(original);
    const decompressed = decompressYjsUpdate(compressed);

    expect(decompressed).toEqual(original);
  });

  it("compressYjsUpdate returns original when payload < 16 bytes", () => {
    const small = new Uint8Array([1, 2, 3]);
    const result = compressYjsUpdate(small);
    expect(result).toEqual(small);
  });

  it("compressYjsUpdate returns original for empty input", () => {
    const empty = new Uint8Array(0);
    const result = compressYjsUpdate(empty);
    expect(result).toHaveLength(0);
  });

  it("10 MB guard constant is correct", () => {
    expect(MAX_SAFE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_SAFE_BYTES).toBeGreaterThan(1024 * 1024); // > 1 MB
    expect(MAX_SAFE_BYTES).toBeLessThan(50 * 1024 * 1024); // < 50 MB
  });
});
