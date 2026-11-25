import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  BoundedSyncOutbox,
  CircuitOpenError,
  ResilienceCircuitBreaker,
} from '@/lib/reliability/circuitAndSyncEngine';
import { SessionHealthPanel } from '@/components/reliability/SessionHealthPanel';

describe('ResilienceCircuitBreaker, BoundedSyncOutbox & SessionHealthPanel', () => {
  it('opens circuit after failures, transitions to half-open after timeout, and closes on recovery', async () => {
    let now = 10_000;
    const breaker = new ResilienceCircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 5_000,
      halfOpenMaxSuccesses: 1,
      nowFn: () => now,
    });

    const failOp = jest.fn().mockRejectedValue(new Error('503 Unavailable'));
    await expect(breaker.execute(failOp)).rejects.toThrow();
    await expect(breaker.execute(failOp)).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    await expect(breaker.execute(failOp)).rejects.toBeInstanceOf(
      CircuitOpenError
    );

    now += 5_000;
    expect(breaker.getState()).toBe('half_open');

    const okOp = jest.fn().mockResolvedValue('ok');
    await expect(breaker.execute(okOp)).resolves.toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('compacts superseded sync events by (version, timestampMs, peerId) and drains bounded outbox', async () => {
    const outbox = new BoundedSyncOutbox<{ title: string }>(2);
    outbox.push({
      id: '0',
      key: 'legacy-note',
      payload: { title: 'evicted' },
      version: 1,
      peerId: 'peer-a',
      timestampMs: 50,
    });
    outbox.push({
      id: '1',
      key: 'note-1',
      payload: { title: 'v1' },
      version: 1,
      peerId: 'peer-a',
      timestampMs: 100,
    });
    outbox.push({
      id: '2',
      key: 'note-1',
      payload: { title: 'v2' },
      version: 2,
      peerId: 'peer-a',
      timestampMs: 200,
    });

    expect(outbox.size()).toBe(2);

    const sent: unknown[] = [];
    const count = await outbox.drain((batch) => {
      sent.push(...batch);
    });
    expect(count).toBe(2);
    expect(outbox.size()).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it('renders session health metrics with clamped energy bar and sync trigger', () => {
    const onSyncNow = jest.fn();
    render(
      <SessionHealthPanel
        venueName="Bandra Cowork"
        pingSamplesMs={[12, 14, 13, 15]}
        actualEnergyKwh={1350}
        baselineEnergyKwh={1000}
        circuitState="closed"
        queuedMutationsCount={4}
        onSyncNow={onSyncNow}
      />
    );

    expect(screen.getByTestId('panel-call-quality').textContent).toBe(
      'Excellent for Video Calls'
    );
    expect(screen.getByTestId('panel-overage-badge').textContent).toBe(
      '+35% above baseline'
    );
    expect(
      (screen.getByTestId('panel-energy-bar') as HTMLElement).style.width
    ).toBe('100%');

    fireEvent.click(screen.getByTestId('panel-sync-btn'));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });
});
