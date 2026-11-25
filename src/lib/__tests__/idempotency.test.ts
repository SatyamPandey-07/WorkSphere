import { MemoryIdempotencyStore, runWithIdempotency } from '../idempotency';

describe('runWithIdempotency', () => {
  it('replays cached response on matching key and payload without re-running handler', async () => {
    const store = new MemoryIdempotencyStore();
    const handler = jest.fn().mockResolvedValue({
      status: 200,
      body: { bookingId: 'bk-101', status: 'CONFIRMED' },
    });

    const first = await runWithIdempotency({
      key: 'idem-key-1',
      payload: { seatId: 'A1', amount: 500 },
      store,
      handler,
    });

    const second = await runWithIdempotency({
      key: 'idem-key-1',
      payload: { seatId: 'A1', amount: 500 },
      store,
      handler,
    });

    expect(first.replayed).toBe(false);
    expect(first.status).toBe(200);
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual({ bookingId: 'bk-101', status: 'CONFIRMED' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when the same Idempotency-Key is sent with a different payload', async () => {
    const store = new MemoryIdempotencyStore();
    const handler = jest.fn().mockResolvedValue({
      status: 200,
      body: { bookingId: 'bk-102' },
    });

    await runWithIdempotency({
      key: 'idem-key-2',
      payload: { seatId: 'A1', amount: 500 },
      store,
      handler,
    });

    const conflict = await runWithIdempotency({
      key: 'idem-key-2',
      payload: { seatId: 'A2', amount: 900 },
      store,
      handler,
    });

    expect(conflict.status).toBe(409);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('allows re-execution after TTL expiry', async () => {
    const store = new MemoryIdempotencyStore();
    let callCount = 0;
    const handler = jest.fn().mockImplementation(async () => ({
      status: 200,
      body: { attempt: ++callCount },
    }));

    const first = await runWithIdempotency({
      key: 'idem-key-3',
      payload: { seatId: 'B1' },
      store,
      ttlMs: 50,
      handler,
    });
    expect(first.body).toEqual({ attempt: 1 });

    await new Promise((resolve) => setTimeout(resolve, 60));

    const afterExpiry = await runWithIdempotency({
      key: 'idem-key-3',
      payload: { seatId: 'B1' },
      store,
      ttlMs: 50,
      handler,
    });
    expect(afterExpiry.replayed).toBe(false);
    expect(afterExpiry.body).toEqual({ attempt: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});