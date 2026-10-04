describe("Queue data structure for venue booking jobs", () => {
  class PriorityQueue<T> {
    private items: { value: T; priority: number }[] = [];
    enqueue(value: T, priority: number): void {
      this.items.push({ value, priority });
      this.items.sort((a, b) => b.priority - a.priority);
    }
    dequeue(): T | null {
      return this.items.shift()?.value ?? null;
    }
    peek(): T | null { return this.items[0]?.value ?? null; }
    size(): number { return this.items.length; }
    isEmpty(): boolean { return this.items.length === 0; }
  }
  it("empty queue returns null on dequeue", () => {
    const q = new PriorityQueue<string>();
    expect(q.dequeue()).toBeNull();
  });
  it("highest priority dequeued first", () => {
    const q = new PriorityQueue<string>();
    q.enqueue("low", 1);
    q.enqueue("high", 10);
    q.enqueue("med", 5);
    expect(q.dequeue()).toBe("high");
  });
  it("peek returns first without removing", () => {
    const q = new PriorityQueue<number>();
    q.enqueue(42, 5);
    expect(q.peek()).toBe(42);
    expect(q.size()).toBe(1);
  });
  it("isEmpty after draining", () => {
    const q = new PriorityQueue<number>();
    q.enqueue(1, 1);
    q.dequeue();
    expect(q.isEmpty()).toBe(true);
  });
});
