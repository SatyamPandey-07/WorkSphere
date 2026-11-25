import { HydrationGate } from "../holdHydration";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("HydrationGate (#7954)", () => {
  it("is open and runs tasks synchronously when no load was started", () => {
    const gate = new HydrationGate();
    const order: string[] = [];

    gate.run(() => order.push("a"));

    expect(gate.isReady).toBe(true);
    expect(order).toEqual(["a"]);
  });

  it("queues tasks while loading and replays them in arrival order", async () => {
    const gate = new HydrationGate();
    const load = deferred();
    const order: string[] = [];

    const hydrating = gate.begin(() => load.promise);
    expect(gate.isReady).toBe(false);

    gate.run(() => order.push("first"));
    gate.run(() => order.push("second"));
    gate.run(() => order.push("third"));
    expect(order).toEqual([]);

    load.resolve();
    await hydrating;

    expect(gate.isReady).toBe(true);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("runs the load before any queued task", async () => {
    const gate = new HydrationGate();
    const order: string[] = [];

    const hydrating = gate.begin(async () => {
      await Promise.resolve();
      order.push("loaded");
    });
    gate.run(() => order.push("task"));
    await hydrating;

    expect(order).toEqual(["loaded", "task"]);
  });

  it("reopens and drains even when the load fails", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const gate = new HydrationGate();
    const order: string[] = [];

    const hydrating = gate.begin(() => Promise.reject(new Error("storage down")));
    gate.run(() => order.push("task"));
    await hydrating;

    expect(gate.isReady).toBe(true);
    expect(order).toEqual(["task"]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("keeps draining when one queued task throws", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const gate = new HydrationGate();
    const load = deferred();
    const order: string[] = [];

    const hydrating = gate.begin(() => load.promise);
    gate.run(() => {
      throw new Error("boom");
    });
    gate.run(() => order.push("after"));
    load.resolve();
    await hydrating;

    expect(order).toEqual(["after"]);
    errorSpy.mockRestore();
  });

  it("runs tasks immediately again once hydration is done", async () => {
    const gate = new HydrationGate();
    await gate.begin(async () => {});
    const order: string[] = [];

    gate.run(() => order.push("now"));

    expect(order).toEqual(["now"]);
  });

  it("whenReady resolves after the load finishes", async () => {
    const gate = new HydrationGate();
    const load = deferred();
    let settled = false;

    gate.begin(() => load.promise);
    const waiter = gate.whenReady().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    load.resolve();
    await waiter;
    expect(settled).toBe(true);
  });
});
