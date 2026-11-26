import { HashedTimingWheel } from '@/lib/venues/hashedTimingWheel';

describe('HashedTimingWheel', () => {
  it('handles multi-revolution delays without premature firing', () => {
    const wheel = new HashedTimingWheel<string>({
      tickMs: 100,
      wheelSize: 8, // 1 full revolution = 800ms
      initialTimeMs: 1_000,
    });

    // 2.5 revolutions = 2000ms -> bucket 0 on round 2
    wheel.schedule('lease-long', 2_000, 'seat-A1');

    const earlyFired = wheel.advanceBy(1_900);
    expect(earlyFired).toHaveLength(0);
    expect(wheel.getPendingCount()).toBe(1);

    const exactFired = wheel.advanceBy(100);
    expect(exactFired).toHaveLength(1);
    expect(exactFired[0]?.id).toBe('lease-long');
    expect(exactFired[0]?.payload).toBe('seat-A1');
    expect(wheel.getPendingCount()).toBe(0);
  });

  it('fires tasks in the same bucket in deterministic FIFO insertion order', () => {
    const wheel = new HashedTimingWheel<string>({ tickMs: 100, wheelSize: 16 });
    const order: string[] = [];

    wheel.schedule('t1', 500, 'first', (t) => order.push(t.id));
    wheel.schedule('t2', 500, 'second', (t) => order.push(t.id));
    wheel.schedule('t3', 500, 'third', (t) => order.push(t.id));

    const fired = wheel.advanceBy(500);
    expect(fired.map((f) => f.id)).toEqual(['t1', 't2', 't3']);
    expect(order).toEqual(['t1', 't2', 't3']);
  });

  it('prevents cancelled or rescheduled stale tasks from firing', () => {
    const wheel = new HashedTimingWheel<string>({ tickMs: 100, wheelSize: 32 });
    const cb = jest.fn();

    wheel.schedule('cancel-me', 400, 'v1', cb);
    wheel.schedule('resched-me', 400, 'old-payload', cb);

    expect(wheel.cancel('cancel-me')).toBe(true);
    expect(wheel.cancel('cancel-me')).toBe(false);

    wheel.reschedule('resched-me', 900, 'new-payload', cb);

    // At 400ms, neither cancelled nor rescheduled task should fire
    expect(wheel.advanceBy(400)).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();

    // At 900ms, rescheduled task fires with updated payload
    const fired = wheel.advanceBy(500);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.id).toBe('resched-me');
    expect(fired[0]?.payload).toBe('new-payload');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('clamps zero or negative delays to the next tick', () => {
    const wheel = new HashedTimingWheel<string>({ tickMs: 100, wheelSize: 16 });
    wheel.schedule('zero-delay', 0, 'z');
    wheel.schedule('neg-delay', -250, 'n');

    expect(wheel.advanceBy(0)).toHaveLength(0);
    const fired = wheel.advanceBy(100);
    expect(fired.map((f) => f.id)).toEqual(['zero-delay', 'neg-delay']);
  });
});