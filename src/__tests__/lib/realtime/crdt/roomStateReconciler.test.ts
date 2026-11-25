import {
  applyMutationToState,
  compareVectorClocks,
  createInitialRoomState,
  createLocalMutation,
  getActiveElements,
  mergeRoomStates,
  type CrdtMutation,
} from '@/lib/realtime/crdt/roomStateReconciler';
import { OfflineOutboxQueue } from '@/lib/realtime/crdt/offlineOutboxQueue';

describe('Room CRDT State Reconciler & Offline Outbox Queue', () => {
  it('classifies vector clock relationships accurately', () => {
    expect(compareVectorClocks({ a: 1 }, { a: 2 })).toBe('before');
    expect(compareVectorClocks({ a: 2 }, { a: 1 })).toBe('after');
    expect(compareVectorClocks({ a: 1, b: 1 }, { a: 1, b: 1 })).toBe('equal');
    expect(compareVectorClocks({ a: 2, b: 1 }, { a: 1, b: 2 })).toBe(
      'concurrent'
    );
  });

  it('guarantees commutativity, associativity, and idempotency across split-brain edits', () => {
    const base = createInitialRoomState<{ text: string }>('room-bandra');

    const m1: CrdtMutation<{ text: string }> = {
      mutationId: 'm1',
      elementId: 'card-1',
      op: 'upsert',
      payload: { text: 'Peer A offline edit' },
      peerId: 'peer-a',
      lamport: 3,
      vectorClock: { 'peer-a': 2, 'peer-b': 1 },
      updatedAtMs: 1_700_000_100,
    };

    const m2: CrdtMutation<{ text: string }> = {
      mutationId: 'm2',
      elementId: 'card-1',
      op: 'upsert',
      payload: { text: 'Peer B concurrent edit' },
      peerId: 'peer-b',
      lamport: 3,
      vectorClock: { 'peer-a': 1, 'peer-b': 2 },
      updatedAtMs: 1_700_000_100,
    };

    const m3: CrdtMutation<{ text: string }> = {
      mutationId: 'm3',
      elementId: 'card-2',
      op: 'upsert',
      payload: { text: 'Sticky note 2' },
      peerId: 'peer-c',
      lamport: 4,
      vectorClock: { 'peer-c': 1 },
      updatedAtMs: 1_700_000_200,
    };

    const stateA = applyMutationToState(base, m1);
    const stateB = applyMutationToState(base, m2);
    const stateC = applyMutationToState(base, m3);

    const ab = mergeRoomStates(stateA, stateB);
    const ba = mergeRoomStates(stateB, stateA);
    expect(ab.elements['card-1']?.payload).toEqual(
      ba.elements['card-1']?.payload
    );

    expect(mergeRoomStates(ab, ab).elements['card-1']?.payload).toEqual(
      ab.elements['card-1']?.payload
    );

    const leftAssoc = mergeRoomStates(mergeRoomStates(stateA, stateB), stateC);
    const rightAssoc = mergeRoomStates(stateA, mergeRoomStates(stateB, stateC));
    expect(getActiveElements(leftAssoc)).toHaveLength(2);
    expect(getActiveElements(rightAssoc)).toHaveLength(2);
    expect(leftAssoc.elements['card-1']?.payload).toEqual(
      rightAssoc.elements['card-1']?.payload
    );
  });

  it('bounds outbox queue size, compacts superseded mutations, and flushes on reconnect', async () => {
    const outbox = new OfflineOutboxQueue<{ label: string }>({
      maxSize: 5,
      storage: null,
    });

    const room = createInitialRoomState<{ label: string }>('room-train');
    const mut1 = createLocalMutation(room, {
      mutationId: 'op-1',
      elementId: 'task-1',
      op: 'upsert',
      payload: { label: 'Draft v1' },
      peerId: 'peer-1',
      updatedAtMs: 1000,
    });
    const mut2 = {
      ...mut1,
      mutationId: 'op-2',
      payload: { label: 'Draft v2' },
      lamport: mut1.lamport + 1,
      vectorClock: { 'peer-1': 2 },
      updatedAtMs: 2000,
    };

    outbox.enqueue(mut1);
    outbox.enqueue(mut2);

    const flushed: CrdtMutation<{ label: string }>[] = [];
    const sentCount = await outbox.flush((batch) => {
      flushed.push(...batch);
    });

    expect(sentCount).toBe(1);
    expect(flushed[0]?.payload).toEqual({ label: 'Draft v2' });
    expect(outbox.size()).toBe(0);
  });
});
