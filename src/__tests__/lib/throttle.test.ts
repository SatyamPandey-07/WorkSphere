import { throttle } from "@/lib/utils";

describe("throttle utility (#6252)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("executes immediately on leading edge by default", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);

    throttled("call 1");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("call 1");
  });

  it("throttles calls within limit window and executes trailing edge with latest arguments", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);

    throttled("first");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("first");

    // Multiple calls during cooldown
    throttled("second");
    throttled("third");
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance timers past limit
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("third");
  });

  it("supports cancel() to abort pending trailing execution", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);

    throttled("initial");
    expect(fn).toHaveBeenCalledTimes(1);

    throttled("pending");
    expect(fn).toHaveBeenCalledTimes(1);

    // Cancel pending execution
    throttled.cancel();

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects leading: false option", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100, { leading: false });

    throttled("test");
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("test");
  });

  it("respects trailing: false option and ignores calls during cooldown", () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100, { trailing: false });

    throttled("leading only");
    expect(fn).toHaveBeenCalledTimes(1);

    throttled("dropped");
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
