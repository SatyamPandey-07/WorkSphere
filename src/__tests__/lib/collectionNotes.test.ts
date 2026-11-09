/**
 * @jest-environment node
 *
 * Conflict-free collection notes (#3360): concurrent edits merge through
 * Yjs exactly as the textarea editor applies them (applyYTextDiff).
 */
import * as Y from "yjs";
import { applyYTextDiff } from "@/lib/crdt/applyYTextDiff";
import {
  MAX_COLLECTION_NOTES_LENGTH,
  collectionNotesRoom,
  createSeedUpdate,
  getCollectionNotesText,
  seedCollectionNotes,
  splitParagraphs,
} from "@/lib/crdt/collectionNotes";

const NOTE = [
  "Wifi: ask the front desk for the guest password.",
  "Quiet zone is on the second floor, past the cafe.",
  "Parking: validated for 2 hours with a booking.",
].join("\n\n");

/** A collaborator's replica, synced from a shared starting state. */
function replica(from?: Y.Doc): Y.Doc {
  const doc = new Y.Doc();
  if (from) Y.applyUpdate(doc, Y.encodeStateAsUpdate(from));
  return doc;
}

const text = (doc: Y.Doc) => getCollectionNotesText(doc).toString();

/** Edit like the textarea does: rewrite one paragraph, then diff into Y.Text. */
function editParagraph(doc: Y.Doc, index: number, edit: (p: string) => string) {
  const paragraphs = splitParagraphs(text(doc));
  paragraphs[index] = edit(paragraphs[index]);
  applyYTextDiff(getCollectionNotesText(doc), paragraphs.join("\n\n"));
}

/** Exchange everything each side is missing (state-vector diff sync). */
function sync(a: Y.Doc, b: Y.Doc) {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, toB, "remote");
  Y.applyUpdate(a, toA, "remote");
}

function seededPair() {
  const origin = new Y.Doc();
  getCollectionNotesText(origin).insert(0, NOTE);
  return [replica(origin), replica(origin)] as const;
}

describe("acceptance: concurrent edits to different paragraphs", () => {
  it("merge cleanly with no data loss", () => {
    const [alice, bob] = seededPair();

    editParagraph(alice, 0, (p) => p.replace("guest password", "guest password (changes Mondays)"));
    editParagraph(bob, 2, (p) => p + " Bike racks by the entrance.");

    sync(alice, bob);

    expect(text(alice)).toBe(text(bob));
    expect(text(alice)).toContain("guest password (changes Mondays)");
    expect(text(alice)).toContain("Bike racks by the entrance.");
    expect(text(alice)).toContain("Quiet zone is on the second floor");
  });

  it("would have lost an edit under the old last-write-wins save", () => {
    // Old behaviour: each client PUTs its whole textarea; the later save wins.
    const aliceSaves = NOTE.replace("guest password", "guest password (changes Mondays)");
    const bobSaves = NOTE + " Bike racks by the entrance.";
    const stored = [aliceSaves, bobSaves].at(-1)!;
    expect(stored).not.toContain("changes Mondays"); // Alice's edit is gone
  });
});

describe("deterministic merging without server locking", () => {
  it("converges to the same text whatever order updates arrive in", () => {
    const origin = new Y.Doc();
    getCollectionNotesText(origin).insert(0, NOTE);
    const users = [replica(origin), replica(origin), replica(origin)];

    editParagraph(users[0], 0, (p) => "📶 " + p);
    editParagraph(users[1], 1, (p) => p.replace("second", "third"));
    editParagraph(users[2], 2, () => "Parking: free after 6pm.");
    const updates = users.map((u) => Y.encodeStateAsUpdate(u));

    const orders = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]];
    const results = orders.map((order) => {
      const doc = replica(origin);
      order.forEach((i) => Y.applyUpdate(doc, updates[i]));
      return text(doc);
    });
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toContain("📶 Wifi");
    expect(results[0]).toContain("third floor");
    expect(results[0]).toContain("free after 6pm");
  });

  it("keeps both sides of concurrent edits to the same paragraph", () => {
    const [alice, bob] = seededPair();
    editParagraph(alice, 1, (p) => "Note: " + p);
    editParagraph(bob, 1, (p) => p + " Bring headphones.");
    sync(alice, bob);
    expect(text(alice)).toBe(text(bob));
    expect(text(alice)).toContain("Note: Quiet zone");
    expect(text(alice)).toContain("Bring headphones.");
  });

  it("merges a concurrent deletion and insertion in different paragraphs", () => {
    const [alice, bob] = seededPair();
    editParagraph(alice, 2, () => ""); // Alice clears the parking paragraph
    editParagraph(bob, 0, (p) => p + " (5 GHz recommended)");
    sync(alice, bob);
    expect(text(alice)).toBe(text(bob));
    expect(text(alice)).toContain("(5 GHz recommended)");
    expect(text(alice)).not.toContain("validated for 2 hours");
  });

  it("merges edits made offline once the user reconnects", () => {
    const [alice, bob] = seededPair();
    for (let i = 0; i < 5; i++) editParagraph(alice, 0, (p) => p + ` (offline ${i})`);
    editParagraph(bob, 2, (p) => p.replace("2 hours", "3 hours"));
    sync(alice, bob);
    expect(text(alice)).toBe(text(bob));
    expect(text(alice)).toContain("(offline 4)");
    expect(text(alice)).toContain("3 hours");
  });
});

describe("seeding from the legacy description", () => {
  it("is idempotent when several clients seed at the same time", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    expect(seedCollectionNotes(a, NOTE)).toBe(true);
    expect(seedCollectionNotes(b, NOTE)).toBe(true);
    sync(a, b);
    expect(text(a)).toBe(NOTE); // not duplicated
    expect(text(b)).toBe(NOTE);
  });

  it("produces byte-identical seed updates for the same text", () => {
    expect(createSeedUpdate(NOTE)).toEqual(createSeedUpdate(NOTE));
    expect(createSeedUpdate(NOTE)).not.toEqual(createSeedUpdate(NOTE + "!"));
  });

  it("never seeds over an existing shared note, and caps the length", () => {
    const doc = new Y.Doc();
    getCollectionNotesText(doc).insert(0, "already here");
    expect(seedCollectionNotes(doc, NOTE)).toBe(false);
    expect(text(doc)).toBe("already here");

    const fresh = new Y.Doc();
    seedCollectionNotes(fresh, "x".repeat(MAX_COLLECTION_NOTES_LENGTH + 50));
    expect(text(fresh)).toHaveLength(MAX_COLLECTION_NOTES_LENGTH);
    expect(seedCollectionNotes(new Y.Doc(), null)).toBe(false);
  });

  it("lets seeded text be edited concurrently like any other", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedCollectionNotes(a, NOTE);
    seedCollectionNotes(b, NOTE);
    editParagraph(a, 0, (p) => p + " A");
    editParagraph(b, 1, (p) => p + " B");
    sync(a, b);
    expect(text(a)).toBe(text(b));
    expect(splitParagraphs(text(a))[0].endsWith(" A")).toBe(true);
    expect(splitParagraphs(text(a))[1].endsWith(" B")).toBe(true);
  });
});

it("uses a dedicated members-only room per collection", () => {
  expect(collectionNotesRoom("ckabc123")).toBe("folder-notes-ckabc123");
});
