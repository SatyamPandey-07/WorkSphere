import { VectorClock } from '../VectorClock';

describe('VectorClock concurrency', () => {
  it('produces strictly monotonic sequence numbers across 10 concurrent packets', async () => {
    const vc = new VectorClock('node-1');

    const snapshots = await Promise.all(
      Array.from({ length: 10 }, async (_, idx) => {
        if (idx % 2 === 0) {
          await Promise.resolve();
        }
        return vc.tick();
      })
    );

    const nodeValues = snapshots.map((snap) => snap['node-1']);
    expect(nodeValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(nodeValues).size).toBe(10);
  });

  it('merges remote vector clocks and increments local counter atomically under concurrency', async () => {
    const vc = new VectorClock('node-a');

    const results = await Promise.all([
      vc.merge({ 'node-b': 3, 'node-a': 1 }),
      vc.tick(),
      vc.merge({ 'node-b': 5, 'node-c': 2 }),
    ]);

    const finalClock = vc.getClock();
    expect(finalClock['node-b']).toBe(5);
    expect(finalClock['node-c']).toBe(2);
    expect(finalClock['node-a']).toBe(3);
    expect(results).toHaveLength(3);
  });
});