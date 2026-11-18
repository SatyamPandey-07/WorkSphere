export class SkippedMessageKeyStore {
  private static SKIPPED_KEYS_MAX_PER_CHAIN = 100;
  private cache = new Map<string, { key: string; timestamp: number; activeWindow: boolean }>();

  public set(chainId: string, messageIndex: number, encryptionKey: string, activeWindow = false) {
    const key = ${chainId}:;
    if (this.cache.size >= SkippedMessageKeyStore.SKIPPED_KEYS_MAX_PER_CHAIN) {
      this.evictOldest(chainId);
    }
    this.cache.set(key, { key: encryptionKey, timestamp: Date.now(), activeWindow });
  }

  public get(chainId: string, messageIndex: number): string | undefined {
    const key = ${chainId}:;
    return this.cache.get(key)?.key;
  }

  private evictOldest(currentChainId: string) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [k, entry] of this.cache.entries()) {
      if (!entry.activeWindow && entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = k;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}