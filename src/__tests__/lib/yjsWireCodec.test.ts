/**
 * @jest-environment node
 *
 * Yjs wire codec + keystroke batching for the PartyKit scratchpad (#1728).
 * Runs in the node environment, which ships native CompressionStream.
 */
import * as Y from "yjs";
import { deflateRawSync } from "zlib";
import {
  WIRE_MAGIC_V2,
  WireCodec,
  YjsWireError,
  compressYjsUpdate,
  createYjsUpdateBatcher,
  decodeYjsWirePayload,
  encodeYjsWirePayload,
} from "@/lib/crdt/yjsCompression";

const NOTES =
  "Meeting notes: discussed the Q3 roadmap, the venue booking flow and the new " +
  "collaborative scratchpad. Action items: Alice drafts the spec, Bob reviews latency. ";

/** Bytes on the wire for one Scratchpad e2ee message carrying `plaintext` bytes. */
function wireBytes(plaintext: number): number {
  const b64 = (n: number) => 4 * Math.ceil(n / 3);
  // AES-GCM ciphertext = plaintext + 16-byte tag; 12-byte IV; both base64 in JSON.
  return JSON.stringify({
    type: "e2ee-delta",
    payload: { ciphertext: "x".repeat(b64(plaintext + 16)), iv: "x".repeat(b64(12)) },
  }).length;
}

function docWithText(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText("scratchpad").insert(0, text);
  return doc;
}

const codecOf = (frame: Uint8Array) => frame[WIRE_MAGIC_V2.length];

describe("wire codec", () => {
  it("frames small updates raw and round-trips them", async () => {
    const doc = new Y.Doc();
    let update = new Uint8Array();
    doc.on("update", (u: Uint8Array) => (update = u));
    doc.getText("scratchpad").insert(0, "a");

    const frame = await encodeYjsWirePayload(update);
    expect(Array.from(frame.subarray(0, 4))).toEqual(Array.from(WIRE_MAGIC_V2));
    expect(codecOf(frame)).toBe(WireCodec.RAW);
    expect(await decodeYjsWirePayload(frame)).toEqual(update);
  });

  it("deflates large state syncs by more than 60% and restores them exactly", async () => {
    const full = Y.encodeStateAsUpdate(docWithText(NOTES.repeat(40)));
    const frame = await encodeYjsWirePayload(full);

    expect(codecOf(frame)).toBe(WireCodec.DEFLATE_RAW);
    expect(1 - frame.length / full.length).toBeGreaterThan(0.6);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, await decodeYjsWirePayload(frame));
    expect(restored.getText("scratchpad").toString()).toBe(NOTES.repeat(40));
  });

  it("never inflates incompressible payloads beyond the 5-byte frame", async () => {
    const noise = new Uint8Array(4096).map(() => Math.floor(Math.random() * 256));
    const frame = await encodeYjsWirePayload(noise);
    expect(codecOf(frame)).toBe(WireCodec.RAW);
    expect(frame.length).toBe(noise.length + 5);
  });

  it("decodes legacy v1 LZ77 packets and bare updates from older clients", async () => {
    const full = Y.encodeStateAsUpdate(docWithText(NOTES.repeat(5)));
    expect(await decodeYjsWirePayload(compressYjsUpdate(full))).toEqual(full);
    expect(await decodeYjsWirePayload(full)).toBe(full);
  });

  it("rejects corrupt, unknown and truncated frames", async () => {
    const corrupt = new Uint8Array([...WIRE_MAGIC_V2, WireCodec.DEFLATE_RAW, 0xff, 0xff, 0xff, 0xff]);
    await expect(decodeYjsWirePayload(corrupt)).rejects.toBeInstanceOf(YjsWireError);
    await expect(decodeYjsWirePayload(new Uint8Array([...WIRE_MAGIC_V2, 0x7f, 1, 2]))).rejects.toThrow(
      /Unknown wire codec/,
    );
    await expect(decodeYjsWirePayload(new Uint8Array(WIRE_MAGIC_V2))).rejects.toThrow(/Truncated/);
  });

  it("refuses decompression bombs past the 10 MB ceiling", async () => {
    const bomb = deflateRawSync(new Uint8Array(11 * 1024 * 1024)); // ~11 KB on the wire
    const frame = new Uint8Array([...WIRE_MAGIC_V2, WireCodec.DEFLATE_RAW, ...bomb]);
    await expect(decodeYjsWirePayload(frame)).rejects.toThrow(/exceeds/);
  });

  it("falls back to raw frames where native compression is unavailable", async () => {
    const original = globalThis.CompressionStream;
    // @ts-expect-error simulate an older browser / jsdom
    delete globalThis.CompressionStream;
    try {
      const full = Y.encodeStateAsUpdate(docWithText(NOTES.repeat(10)));
      const frame = await encodeYjsWirePayload(full);
      expect(codecOf(frame)).toBe(WireCodec.RAW);
      expect(await decodeYjsWirePayload(frame)).toEqual(full);
    } finally {
      globalThis.CompressionStream = original;
    }
  });

  it("decodes asynchronously, yielding to the event loop instead of blocking it", async () => {
    const big = Y.encodeStateAsUpdate(docWithText(NOTES.repeat(20000))); // ~3 MB
    const frame = await encodeYjsWirePayload(big);

    let yielded = false;
    setImmediate(() => (yielded = true));
    const decoded = await decodeYjsWirePayload(frame);

    expect(yielded).toBe(true);
    expect(decoded.length).toBe(big.length);
  });
});

describe("keystroke batcher", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function typingDoc() {
    const doc = new Y.Doc();
    const text = doc.getText("scratchpad");
    const flushed: Uint8Array[] = [];
    const batcher = createYjsUpdateBatcher({ onFlush: (u) => flushed.push(u), windowMs: 250 });
    doc.on("update", (u: Uint8Array) => batcher.push(u));
    const type = (s: string) => {
      for (const ch of s) text.insert(text.length, ch);
    };
    return { doc, batcher, flushed, type };
  }

  it("sends the first keystroke after a pause immediately", () => {
    const { flushed, type } = typingDoc();
    type("h");
    expect(flushed).toHaveLength(1);
  });

  it("merges a burst into one update per window that reproduces the document", () => {
    const { doc, flushed, type } = typingDoc();
    type("h"); // leading edge
    type("ello world"); // burst inside the window
    expect(flushed).toHaveLength(1);

    jest.advanceTimersByTime(250);
    expect(flushed).toHaveLength(2);

    const replica = new Y.Doc();
    flushed.forEach((u) => Y.applyUpdate(replica, u));
    expect(replica.getText("scratchpad").toString()).toBe(doc.getText("scratchpad").toString());
  });

  it("flushes early on large pastes and when disposed", () => {
    const flushed: Uint8Array[] = [];
    const batcher = createYjsUpdateBatcher({ onFlush: (u) => flushed.push(u), maxPendingBytes: 100 });
    batcher.push(new Uint8Array(10)); // leading edge
    batcher.push(new Uint8Array(150)); // over the byte budget
    expect(flushed).toHaveLength(2);

    batcher.push(new Uint8Array(5));
    expect(batcher.pendingCount).toBe(1);
    batcher.dispose();
    expect(flushed).toHaveLength(3);

    batcher.push(new Uint8Array(5));
    jest.advanceTimersByTime(1000);
    expect(flushed).toHaveLength(3);
  });
});

describe("bandwidth for an active collaboration session", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("cuts Scratchpad wire bytes by 60%+ while two users type concurrently, and both converge", async () => {
    const CPS = 10; // characters per second, per user
    const users = ["alice", "bob"].map((name) => {
      const doc = new Y.Doc();
      const perKeystroke: Uint8Array[] = [];
      const batched: Uint8Array[] = [];
      // Default window (400 ms)
      const batcher = createYjsUpdateBatcher({ onFlush: (u) => batched.push(u) });
      doc.on("update", (u: Uint8Array, origin: unknown) => {
        if (origin === "remote") return;
        perKeystroke.push(u);
        batcher.push(u);
      });
      return { name, doc, perKeystroke, batched, batcher };
    });

    const script = NOTES.repeat(2);
    for (let i = 0; i < script.length; i++) {
      for (const u of users) {
        const t = u.doc.getText("scratchpad");
        t.insert(t.length, `${script[i]}`);
      }
      jest.advanceTimersByTime(1000 / CPS);
    }
    users.forEach((u) => u.batcher.dispose());

    // Deliver every batch through the real codec to the other peer.
    for (const [from, to] of [[0, 1], [1, 0]] as const) {
      for (const update of users[from].batched) {
        const frame = await encodeYjsWirePayload(update);
        Y.applyUpdate(users[to].doc, await decodeYjsWirePayload(frame), "remote");
      }
    }
    expect(users[0].doc.getText("scratchpad").toString()).toBe(
      users[1].doc.getText("scratchpad").toString(),
    );

    const before = users.flatMap((u) => u.perKeystroke).reduce((s, u) => s + wireBytes(u.length), 0);
    let after = 0;
    for (const u of users) {
      for (const update of u.batched) after += wireBytes((await encodeYjsWirePayload(update)).length);
    }
    const reduction = 1 - after / before;
    expect(reduction).toBeGreaterThanOrEqual(0.6);
  });
});
