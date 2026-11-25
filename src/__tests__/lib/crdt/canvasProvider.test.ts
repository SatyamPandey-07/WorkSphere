import * as Y from 'yjs';
import {
  CompactingCrdtJournal,
  OfflineCanvasProvider,
  encodeBinaryFrameChunks,
  BinaryFrameReassembler,
} from '@/lib/crdt/canvasProvider';

describe('CompactingCrdtJournal & OfflineCanvasProvider', () => {
  test('compacts queued updates via Y.mergeUpdates when entry count exceeds 50', async () => {
    const doc = new Y.Doc();
    const yText = doc.getText('notes');
    const mergeSpy = jest.spyOn(Y, 'mergeUpdates');

    const journal = new CompactingCrdtJournal({
      roomId: 'room-compaction-50',
      doc,
      entryThreshold: 50,
      byteThreshold: 64 * 1024,
    });

    // Simulate 51 offline keystrokes
    for (let i = 0; i < 51; i++) {
      const prevState = Y.encodeStateVector(doc);
      yText.insert(yText.length, 'a');
      const incrementalUpdate = Y.encodeStateAsUpdate(doc, prevState);
      await journal.appendUpdate(incrementalUpdate);
    }

    expect(mergeSpy).toHaveBeenCalledTimes(1);

    const remainingEntries = await journal.getAllEntries();
    expect(remainingEntries).toHaveLength(1);

    // Verify merged update reconstructs full 51-character document state losslessly
    const targetDoc = new Y.Doc();
    Y.applyUpdate(targetDoc, remainingEntries[0].update);
    expect(targetDoc.getText('notes').toString()).toBe('a'.repeat(51));

    mergeSpy.mockRestore();
  });

  test('compacts queued updates when buffered bytes exceed 64 KB threshold', async () => {
    const doc = new Y.Doc();
    const mergeSpy = jest.spyOn(Y, 'mergeUpdates');

    const journal = new CompactingCrdtJournal({
      roomId: 'room-compaction-64kb',
      doc,
      entryThreshold: 50,
      byteThreshold: 64 * 1024,
    });

    // Two 40 KB updates = 80 KB > 64 KB threshold (even though count is only 2 <= 50)
    await journal.appendUpdate(new Uint8Array(40 * 1024).fill(1));
    const result = await journal.appendUpdate(new Uint8Array(40 * 1024).fill(2));

    expect(result.compacted).toBe(true);
    expect(mergeSpy).toHaveBeenCalledTimes(1);
    expect(await journal.getAllEntries()).toHaveLength(1);

    mergeSpy.mockRestore();
  });

  test('chunks large merged updates into <= 32 KB binary frames and reassembles cleanly over PartyKit', async () => {
    const sourceDoc = new Y.Doc();
    const provider = new OfflineCanvasProvider({
      roomId: 'room-replay-chunked',
      doc: sourceDoc,
      maxChunkBytes: 32 * 1024,
    });

    provider.setOnlineStatus(false);

    // Generate 120 offline paragraph edits
    const yText = sourceDoc.getText('shared-note');
    for (let i = 0; i < 120; i++) {
      yText.insert(yText.length, `Line ${i}: Collaborative nomad note payload.\n`);
    }

    const sentPayloads: Uint8Array[] = [];
    const mockSocket = {
      readyState: 1,
      send: jest.fn((data: string | ArrayBuffer | Uint8Array) => {
        if (data instanceof Uint8Array) {
          sentPayloads.push(data);
        }
      }),
    };

    const replayStats = await provider.attachSocketAndReplay(mockSocket);

    expect(replayStats.sentFrames).toBeGreaterThanOrEqual(1);
    expect(sentPayloads.length).toBe(replayStats.sentFrames);

    // Every single WebSocket frame stays strictly bounded below 32 KB + 16-byte header
    for (const frame of sentPayloads) {
      expect(frame.byteLength).toBeLessThanOrEqual(32 * 1024 + 16);
    }

    // Reassemble frames on receiver side and apply to fresh Y.Doc
    const reassembler = new BinaryFrameReassembler();
    let reassembledUpdate: Uint8Array | null = null;
    for (const frame of sentPayloads) {
      reassembledUpdate = reassembler.pushFrame(frame);
    }

    expect(reassembledUpdate).not.toBeNull();
    const replicaDoc = new Y.Doc();
    Y.applyUpdate(replicaDoc, reassembledUpdate!);
    expect(replicaDoc.getText('shared-note').toString()).toBe(yText.toString());

    provider.destroy();
  });

  test('encodeBinaryFrameChunks splits a 90 KB update into 3 frames of <= 32 KB', () => {
    const largePayload = new Uint8Array(90 * 1024);
    for (let i = 0; i < largePayload.length; i++) {
      largePayload[i] = i & 0xff;
    }

    const frames = encodeBinaryFrameChunks(largePayload, 32 * 1024, 42);
    expect(frames).toHaveLength(3);

    const reassembler = new BinaryFrameReassembler();
    expect(reassembler.pushFrame(frames[0].wireBuffer)).toBeNull();
    expect(reassembler.pushFrame(frames[1].wireBuffer)).toBeNull();
    const output = reassembler.pushFrame(frames[2].wireBuffer);

    expect(output).toEqual(largePayload);
  });
});