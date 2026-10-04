import { describe, it, expect } from "@jest/globals";
import * as Y from "yjs";

describe("Collaborative Whiteboard Yjs CRDT Sync (#2167)", () => {
  it("applies a binary Yjs update correctly", () => {
    const source = new Y.Doc();
    const target = new Y.Doc();

    const shapes =
      source.getArray<Y.Map<unknown>>("shapes");

    source.transact(() => {
      const shape = new Y.Map<unknown>();

      shape.set("id", "shape-1");
      shape.set("type", "rect");

      shapes.push([shape]);
    });

    const update = Y.encodeStateAsUpdate(source);

    expect(update).toBeInstanceOf(Uint8Array);

    Y.applyUpdate(target, update);

    const targetShapes =
      target.getArray<Y.Map<unknown>>("shapes");

    expect(targetShapes.length).toBe(1);

    const syncedShape = targetShapes.get(0);

    expect(syncedShape.get("id")).toBe("shape-1");
    expect(syncedShape.get("type")).toBe("rect");
  });

  it("converges after concurrent edits without data loss", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    docA.getArray<string>("shapes").push(["shapeA"]);
    docB.getArray<string>("shapes").push(["shapeB"]);

    const updateA = Y.encodeStateAsUpdate(docA);
    const updateB = Y.encodeStateAsUpdate(docB);

    // Exchange both independent updates.
    Y.applyUpdate(docA, updateB);
    Y.applyUpdate(docB, updateA);

    expect(
      docA.getArray<string>("shapes").length,
    ).toBe(2);

    expect(
      docB.getArray<string>("shapes").length,
    ).toBe(2);

    expect(
      docA.getArray<string>("shapes").toJSON(),
    ).toEqual(
      docB.getArray<string>("shapes").toJSON(),
    );
  });

  it("synchronizes sticky-note data through Yjs", () => {
    const source = new Y.Doc();
    const target = new Y.Doc();

    const shapes =
      source.getArray<Y.Map<unknown>>("shapes");

    source.transact(() => {
      const sticky = new Y.Map<unknown>();

      sticky.set("id", "sticky-1");
      sticky.set("type", "sticky");
      sticky.set(
        "text",
        "Collaborative whiteboard test",
      );
      sticky.set("x", 120);
      sticky.set("y", 240);

      shapes.push([sticky]);
    });

    Y.applyUpdate(
      target,
      Y.encodeStateAsUpdate(source),
    );

    const syncedSticky =
      target
        .getArray<Y.Map<unknown>>("shapes")
        .get(0);

    expect(syncedSticky.get("id")).toBe("sticky-1");
    expect(syncedSticky.get("type")).toBe("sticky");
    expect(syncedSticky.get("text")).toBe(
      "Collaborative whiteboard test",
    );
    expect(syncedSticky.get("x")).toBe(120);
    expect(syncedSticky.get("y")).toBe(240);
  });
});
