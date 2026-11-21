import {
  chunkPayload,
  ReassemblyBuffer,
  sendWithBackpressure,
  type DataChannelLike,
} from '../DataChannelChunker';

describe('DataChannelChunker & ReassemblyBuffer', () => {
  it('chunks large payloads and reassembles out-of-order frames identically', () => {
    const largePayload = JSON.stringify({
      crdtSnapshot: 'x'.repeat(42_000),
      seats: Array.from({ length: 120 }, (_, i) => ({ id: `seat-${i}`, held: i % 3 === 0 })),
    });

    const frames = chunkPayload(largePayload, 'msg-101', { chunkSizeBytes: 1024 });
    expect(frames.length).toBeGreaterThan(30);

    const reassembly = new ReassemblyBuffer();
    const reversed = [...frames].reverse();

    let finalPayload: string | undefined;
    for (let i = 0; i < reversed.length; i++) {
      const res = reassembly.ingest(reversed[i], 1000 + i * 10);
      if (i < reversed.length - 1) {
        expect(res.status).toBe('INCOMPLETE');
      } else {
        expect(res.status).toBe('COMPLETE');
        finalPayload = res.payload;
      }
    }

    expect(finalPayload).toBe(largePayload);
    expect(reassembly.pendingCount).toBe(0);
  });

  it('pauses sending under high bufferedAmount and resumes once drained', async () => {
    const sent: string[] = [];
    const listeners = new Set<() => void>();

    const channel: DataChannelLike = {
      bufferedAmount: 80_000,
      bufferedAmountLowThreshold: 0,
      send(data: string) {
        sent.push(data);
        channel.bufferedAmount += 10_000;
      },
      addEventListener(type: string, cb: () => void) {
        if (type === 'bufferedamountlow') listeners.add(cb);
      },
      removeEventListener(type: string, cb: () => void) {
        if (type === 'bufferedamountlow') listeners.delete(cb);
      },
    };

    setTimeout(() => {
      channel.bufferedAmount = 0;
      for (const cb of listeners) cb();
    }, 30);

    const payload = 'payload-chunk-'.repeat(2500);
    const stats = await sendWithBackpressure(channel, payload, 'msg-bp-1', {
      chunkSizeBytes: 8192,
      highWaterMarkBytes: 65536,
      lowWaterMarkBytes: 16384,
      pollIntervalMs: 10,
    });

    expect(stats.pauses).toBeGreaterThanOrEqual(1);
    expect(stats.chunksSent).toBeGreaterThan(2);
    expect(sent.length).toBe(stats.chunksSent);
  });

  it('garbage collects stale incomplete chunk sets after ttlMs', () => {
    const buffer = new ReassemblyBuffer({ ttlMs: 5000 });
    const frames = chunkPayload('hello world '.repeat(2000), 'stale-msg', {
      chunkSizeBytes: 1024,
    });

    const first = buffer.ingest(frames[0], 10_000);
    expect(first.status).toBe('INCOMPLETE');
    expect(buffer.pendingCount).toBe(1);

    buffer.gc(14_000);
    expect(buffer.pendingCount).toBe(1);

    const evicted = buffer.gc(15_500);
    expect(evicted).toBe(1);
    expect(buffer.pendingCount).toBe(0);
  });
});