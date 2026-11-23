import { SkippedMessageKeyStore } from "../SkippedMessageKeyStore";
import { randomBytes } from "crypto";

describe("SkippedMessageKeyStore LRU Eviction", () => {
  it("retains active window keys and evicts oldest skipped keys during burst out-of-order delivery", () => {
    const store = new SkippedMessageKeyStore({
      sessionId: "test-session",
      maxGlobalKeys: 100,
      maxKeysPerChain: 100,
    });
    const chain =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    store.storeSkippedKey(chain, 1, randomBytes(32));
    for (let i = 2; i <= 105; i++) {
      store.storeSkippedKey(chain, i, randomBytes(32));
    }

    // Oldest key (1) was evicted when capacity exceeded
    expect(store.hasSkippedKey(chain, 1)).toBe(false);
    expect(store.hasSkippedKey(chain, 105)).toBe(true);
  });
});
