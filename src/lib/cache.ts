export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  invalidate(key: string): void;
  clear(): void;
  has?(key: string): boolean;
  readonly size?: number;
  dispose?(): void;
}

interface LRUNode<T> {
  key: string;
  value: T;
  expiresAt: number;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
}

export class LRUCache<T> implements Cache<T> {
  private capacity: number;
  private ttlMs: number;
  private cache: Map<string, LRUNode<T>>;
  private head: LRUNode<T>; // Sentinel MRU head node
  private tail: LRUNode<T>; // Sentinel LRU tail node
  private cleanupInterval: ReturnType<typeof setInterval>;

  /**
   * @param capacity Maximum number of items the cache can hold
   * @param ttlMs Time to live for each item in milliseconds
   */
  constructor(capacity: number, ttlMs: number) {
    const normalizedCapacity =
      typeof capacity === "number" && Number.isFinite(capacity)
        ? Math.floor(capacity)
        : NaN;
    if (!Number.isFinite(normalizedCapacity) || normalizedCapacity <= 0) {
      throw new Error("Capacity must be greater than 0");
    }
    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("TTL must be a positive number in milliseconds");
    }
    this.capacity = normalizedCapacity;
    this.ttlMs = ttlMs;
    this.cache = new Map();

    // Sentinel nodes for doubly-linked list
    this.head = {
      key: "__head_sentinel__",
      value: undefined as any,
      expiresAt: Infinity,
      prev: null,
      next: null,
    };
    this.tail = {
      key: "__tail_sentinel__",
      value: undefined as any,
      expiresAt: Infinity,
      prev: null,
      next: null,
    };

    this.head.next = this.tail;
    this.tail.prev = this.head;

    const intervalTime = Math.min(ttlMs, 60000);
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      Math.max(1000, intervalTime),
    );

    if (
      this.cleanupInterval &&
      typeof (this.cleanupInterval as any).unref === "function"
    ) {
      (this.cleanupInterval as any).unref();
    }
  }

  /**
   * Safely detaches a node from the doubly-linked list preserving pointer symmetry (#4381).
   */
  private detachNode(node: LRUNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }
    node.prev = null;
    node.next = null;
  }

  /**
   * Inserts a node immediately after the MRU head sentinel.
   */
  private insertAtHead(node: LRUNode<T>): void {
    node.next = this.head.next;
    node.prev = this.head;
    if (this.head.next) {
      this.head.next.prev = node;
    }
    this.head.next = node;
  }

  /**
   * Moves an existing node to the MRU head position.
   */
  private moveToHead(node: LRUNode<T>): void {
    this.detachNode(node);
    this.insertAtHead(node);
  }

  /**
   * Evicts the least recently used node (node prior to tail sentinel).
   */
  private evictTail(): LRUNode<T> | null {
    const lastNode = this.tail.prev;
    if (!lastNode || lastNode === this.head) {
      return null;
    }
    this.detachNode(lastNode);
    this.cache.delete(lastNode.key);
    return lastNode;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, node] of this.cache.entries()) {
      if (now > node.expiresAt) {
        this.detachNode(node);
        this.cache.delete(key);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }

    if (Date.now() > node.expiresAt) {
      this.detachNode(node);
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  get(key: string): T | undefined {
    const node = this.cache.get(key);
    if (!node) {
      return undefined;
    }

    if (Date.now() > node.expiresAt) {
      this.detachNode(node);
      this.cache.delete(key);
      return undefined;
    }

    // Refresh node position to MRU head
    this.moveToHead(node);

    return node.value;
  }

  set(key: string, value: T): void {
    const expiresAt = Date.now() + this.ttlMs;
    const existing = this.cache.get(key);

    if (existing) {
      existing.value = value;
      existing.expiresAt = expiresAt;
      this.moveToHead(existing);
    } else {
      const newNode: LRUNode<T> = {
        key,
        value,
        expiresAt,
        prev: null,
        next: null,
      };
      this.cache.set(key, newNode);
      this.insertAtHead(newNode);

      // Enforce capacity limit atomically
      while (this.cache.size > this.capacity) {
        const evicted = this.evictTail();
        if (!evicted) break;
      }
    }
  }

  invalidate(key: string): void {
    const node = this.cache.get(key);
    if (node) {
      this.detachNode(node);
      this.cache.delete(key);
    }
  }

  clear(): void {
    for (const node of this.cache.values()) {
      node.prev = null;
      node.next = null;
    }
    this.cache.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    this.clear();
  }

  /**
   * Helper verifying doubly-linked list pointer symmetry and capacity integrity (#4381).
   */
  public verifyIntegrity(): boolean {
    let count = 0;
    let curr = this.head.next;

    while (curr && curr !== this.tail) {
      if (curr.next && curr.next.prev !== curr) return false;
      if (curr.prev && curr.prev.next !== curr) return false;
      count++;
      curr = curr.next;
      if (count > this.capacity + 5) return false; // Cycle detection
    }

    return count === this.cache.size;
  }
}
