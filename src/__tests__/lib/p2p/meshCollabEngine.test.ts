import { MeshCollabEngine } from "@/lib/p2p/meshCollabEngine";
import { MeshBloomFilter } from "@/lib/p2p/meshBloomFilter";

describe("MeshCollabEngine Bloom Filter Deduplication Integration", () => {
  it("creates a properly configured MeshBloomFilter via createMessageBloomFilter", () => {
    const filter = MeshCollabEngine.createMessageBloomFilter({
      capacity: 3000,
      targetFpr: 0.0005,
      autoRotate: false,
    });

    expect(filter).toBeInstanceOf(MeshBloomFilter);
    expect(filter.capacity).toBe(3000);
    expect(filter.targetFpr).toBe(0.0005);
  });

  it("checks duplicates correctly with isDuplicateMessage", () => {
    const filter = MeshCollabEngine.createMessageBloomFilter({
      autoRotate: false,
    });
    const payload = new Uint8Array([1, 2, 3, 4, 5]).buffer;

    // First check should not be duplicate
    expect(MeshCollabEngine.isDuplicateMessage(filter, payload)).toBe(false);

    // Second check of identical payload should be flagged as duplicate
    expect(MeshCollabEngine.isDuplicateMessage(filter, payload)).toBe(true);
  });

  it("calculates estimated bandwidth savings accurately in KB", () => {
    // 0 dropped messages = 0 KB
    expect(MeshCollabEngine.calculateBandwidthSavedKb(0)).toBe(0);

    // 10 dropped messages of default 1024 bytes = 10 KB
    expect(MeshCollabEngine.calculateBandwidthSavedKb(10)).toBe(10);

    // 100 dropped messages of 2048 bytes = 200 KB
    expect(MeshCollabEngine.calculateBandwidthSavedKb(100, 2048)).toBe(200);
  });
});
