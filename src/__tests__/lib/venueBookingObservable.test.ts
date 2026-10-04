describe("Observable pattern for venue booking state", () => {
  class Observable<T> {
    private value: T;
    private subscribers: ((v: T) => void)[] = [];
    constructor(initial: T) { this.value = initial; }
    getValue(): T { return this.value; }
    setValue(v: T): void { this.value = v; this.subscribers.forEach((fn) => fn(v)); }
    subscribe(fn: (v: T) => void): () => void {
      this.subscribers.push(fn);
      return () => { this.subscribers = this.subscribers.filter((s) => s !== fn); };
    }
    subscriberCount(): number { return this.subscribers.length; }
  }
  it("getValue returns initial", () => {
    const o = new Observable(42);
    expect(o.getValue()).toBe(42);
  });
  it("setValue updates value", () => {
    const o = new Observable(0);
    o.setValue(99);
    expect(o.getValue()).toBe(99);
  });
  it("subscribe is called on change", () => {
    const o = new Observable("a");
    let received = "";
    o.subscribe((v) => { received = v; });
    o.setValue("b");
    expect(received).toBe("b");
  });
  it("unsubscribe stops notifications", () => {
    const o = new Observable(0);
    let count = 0;
    const unsub = o.subscribe(() => count++);
    unsub();
    o.setValue(1);
    expect(count).toBe(0);
  });
});
