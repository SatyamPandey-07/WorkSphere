describe("Cache utilities for venue booking", () => {
  class SimpleCache<T> {
    private store = new Map<string, { value: T; expiresAt: number }>();
    set(key: string, value: T, ttlMs: number): void {
      this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
    get(key: string): T | null {
      const entry = this.store.get(key);
      if (!entry || Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
      return entry.value;
    }
    has(key: string): boolean { return this.get(key) !== null; }
    delete(key: string): void { this.store.delete(key); }
    size(): number { return this.store.size; }
  }
  it("set and get returns value", () => {
    const c = new SimpleCache<number>();
    c.set("k", 42, 60_000);
    expect(c.get("k")).toBe(42);
  });
  it("get expired returns null", () => {
    const c = new SimpleCache<number>();
    c.set("k", 1, 0);
    expect(c.get("k")).toBeNull();
  });
  it("has returns true for existing", () => {
    const c = new SimpleCache<string>();
    c.set("k", "v", 60_000);
    expect(c.has("k")).toBe(true);
  });
  it("delete removes entry", () => {
    const c = new SimpleCache<string>();
    c.set("k", "v", 60_000);
    c.delete("k");
    expect(c.has("k")).toBe(false);
  });
});
