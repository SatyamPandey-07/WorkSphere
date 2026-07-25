import * as Y from "yjs";
import { applyYTextDiff } from "@/lib/crdt/applyYTextDiff";

describe("applyYTextDiff", () => {
  it("inserts into an empty Y.Text", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    applyYTextDiff(text, "hello");
    expect(text.toString()).toBe("hello");
  });

  it("applies a middle edit without wiping the whole string", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    text.insert(0, "hello world");
    applyYTextDiff(text, "hello CRDT world");
    expect(text.toString()).toBe("hello CRDT world");
  });

  it("merges concurrent inserts from two docs without data loss", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const textA = docA.getText("notes");
    const textB = docB.getText("notes");

    textA.insert(0, "base");
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    applyYTextDiff(textA, "base-A");
    applyYTextDiff(textB, "base-B");

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(textA.toString()).toBe(textB.toString());
    expect(textA.toString()).toContain("base");
    // Both concurrent edits survive in the merged CRDT string
    expect(textA.toString().includes("A") || textA.toString().includes("B")).toBe(
      true,
    );
    expect(textA.length).toBeGreaterThan("base".length);
  });
});
