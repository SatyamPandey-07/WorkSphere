import { CanvasCrdtMerger } from '@/lib/realtime/canvasCrdtMerger';

interface ShapeData {
  x: number;
  y: number;
  label: string;
}

describe('CanvasCrdtMerger (LWW-Element-Set)', () => {
  it('is commutative, associative, and idempotent across concurrent edits', () => {
    const peerA = new CanvasCrdtMerger<ShapeData>();
    peerA.applyMutation({
      elementId: 'note-1',
      kind: 'upsert',
      data: { x: 10, y: 20, label: 'From A' },
      lamport: 3,
      peerId: 'peer-a',
    });

    const peerB = new CanvasCrdtMerger<ShapeData>();
    peerB.applyMutation({
      elementId: 'note-1',
      kind: 'upsert',
      data: { x: 80, y: 90, label: 'From B' },
      lamport: 3,
      peerId: 'peer-b',
    });

    const peerC = new CanvasCrdtMerger<ShapeData>();
    peerC.applyMutation({
      elementId: 'note-2',
      kind: 'upsert',
      data: { x: 5, y: 15, label: 'From C' },
      lamport: 2,
      peerId: 'peer-c',
    });

    const ab = CanvasCrdtMerger.merge(peerA, peerB).toSnapshot();
    const ba = CanvasCrdtMerger.merge(peerB, peerA).toSnapshot();
    expect(ab).toEqual(ba);
    // 'peer-b' > 'peer-a' at lamport 3
    expect(ab.entries['note-1']?.data.label).toBe('From B');

    // Associativity: merge(merge(A, B), C) === merge(A, merge(B, C))
    const leftAssoc = CanvasCrdtMerger.merge(ab, peerC.toSnapshot()).toSnapshot();
    const rightAssoc = CanvasCrdtMerger.merge(
      peerA.toSnapshot(),
      CanvasCrdtMerger.merge(peerB, peerC).toSnapshot()
    ).toSnapshot();
    expect(leftAssoc).toEqual(rightAssoc);

    // Idempotence: merge(AB, B) === AB
    const idempotent = CanvasCrdtMerger.merge(ab, peerB.toSnapshot()).toSnapshot();
    expect(idempotent).toEqual(ab);
  });

  it('handles out-of-order replay and gives tombstone deletion precedence on equal causal rank', () => {
    const merger = new CanvasCrdtMerger<ShapeData>();

    // Out-of-order: higher lamport arrives first, then stale lower lamport arrives later
    merger.applyMutation({
      elementId: 'card-1',
      kind: 'upsert',
      data: { x: 200, y: 100, label: 'Latest' },
      lamport: 5,
      peerId: 'peer-1',
    });
    merger.applyMutation({
      elementId: 'card-1',
      kind: 'upsert',
      data: { x: 0, y: 0, label: 'Stale' },
      lamport: 2,
      peerId: 'peer-2',
    });
    expect(merger.getActiveElements()[0]?.data.label).toBe('Latest');

    // Equal (lamport: 5, peerId: 'peer-1') delete tombstone wins over upsert
    merger.applyMutation({
      elementId: 'card-1',
      kind: 'delete',
      lamport: 5,
      peerId: 'peer-1',
    });
    expect(merger.getActiveElements()).toHaveLength(0);
    expect(merger.toSnapshot().entries['card-1']?.deleted).toBe(true);
  });
});