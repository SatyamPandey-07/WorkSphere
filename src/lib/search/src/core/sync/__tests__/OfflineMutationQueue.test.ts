import { OfflineMutationQueue } from '../OfflineMutationQueue';

describe('OfflineMutationQueue', () => {
  it('replays mutations in causal/FIFO order and removes succeeded items', async () => {
    const queue = new OfflineMutationQueue<{ seat: string }>();
    queue.enqueue({ id: 'm-2', type: 'HOLD_SEAT', payload: { seat: 'A2' }, orderKey: 20 });
    queue.enqueue({ id: 'm-1', type: 'HOLD_SEAT', payload: { seat: 'A1' }, orderKey: 10 });
    queue.enqueue({ id: 'm-3', type: 'CONFIRM_SEAT', payload: { seat: 'A1' }, orderKey: 30 });

    const seenOrder: string[] = [];
    const summary = await queue.drain(async (mut) => {
      seenOrder.push(mut.id);
    });

    expect(seenOrder).toEqual(['m-1', 'm-2', 'm-3']);
    expect(summary.succeeded).toEqual(['m-1', 'm-2', 'm-3']);
    expect(queue.getSnapshot().items).toHaveLength(0);
  });

  it('stops retrying immediately on 4xx client errors while retrying transient errors up to maxRetries', async () => {
    const queue = new OfflineMutationQueue<Record<string, unknown>>({ defaultMaxRetries: 3 });

    queue.enqueue({ id: 'bad-req', type: 'BOOK_DESK', payload: { invalid: true } });
    queue.enqueue({ id: 'flaky-req', type: 'SYNC_NOTE', payload: { note: 'hi' }, maxRetries: 2 });

    const runOnce = () =>
      queue.drain(async (mut) => {
        if (mut.id === 'bad-req') {
          const err = Object.assign(new Error('Validation failed'), { status: 400 });
          throw err;
        }
        if (mut.id === 'flaky-req') {
          throw new Error('Network timeout');
        }
      });

    const d1 = await runOnce();
    expect(d1.failed).toEqual(['bad-req']);
    expect(d1.requeued).toEqual(['flaky-req']);

    const d2 = await runOnce();
    expect(d2.failed).toEqual(['flaky-req']);

    const snap = queue.getSnapshot();
    expect(snap.failedCount).toBe(2);
    expect(snap.items.find((i) => i.id === 'bad-req')?.attempts).toBe(1);
    expect(snap.items.find((i) => i.id === 'flaky-req')?.attempts).toBe(2);

    expect(queue.retryFailed('flaky-req')).toBe(1);
    expect(queue.getSnapshot().items.find((i) => i.id === 'flaky-req')?.status).toBe('PENDING');
  });
});