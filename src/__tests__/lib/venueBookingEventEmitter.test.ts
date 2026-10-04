describe("Event emitter for venue booking", () => {
  class EventEmitter<T extends Record<string, unknown>> {
    private listeners = new Map<keyof T, ((data: unknown) => void)[]>();
    on<K extends keyof T>(event: K, fn: (data: T[K]) => void): void {
      const arr = this.listeners.get(event) ?? [];
      arr.push(fn as (data: unknown) => void);
      this.listeners.set(event, arr);
    }
    emit<K extends keyof T>(event: K, data: T[K]): void {
      (this.listeners.get(event) ?? []).forEach((fn) => fn(data));
    }
    off<K extends keyof T>(event: K): void { this.listeners.delete(event); }
    listenerCount<K extends keyof T>(event: K): number {
      return (this.listeners.get(event) ?? []).length;
    }
  }
  type Events = { booked: { id: string }; cancelled: { id: string } };
  it("on + emit calls listener", () => {
    const ee = new EventEmitter<Events>();
    let called = false;
    ee.on("booked", () => { called = true; });
    ee.emit("booked", { id: "b1" });
    expect(called).toBe(true);
  });
  it("multiple listeners all called", () => {
    const ee = new EventEmitter<Events>();
    let count = 0;
    ee.on("booked", () => count++);
    ee.on("booked", () => count++);
    ee.emit("booked", { id: "b1" });
    expect(count).toBe(2);
  });
  it("off removes listeners", () => {
    const ee = new EventEmitter<Events>();
    ee.on("booked", () => {});
    ee.off("booked");
    expect(ee.listenerCount("booked")).toBe(0);
  });
});
