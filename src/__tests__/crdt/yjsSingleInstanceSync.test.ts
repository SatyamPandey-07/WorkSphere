import * as Y from "yjs";

describe("Yjs single instance and CRDT state sync", () => {
  it("synchronizes document updates cleanly across two Y.Doc instances", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const textA = docA.getText("shared");
    const textB = docB.getText("shared");

    textA.insert(0, "Hello from WorkSphere");

    const update = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, update);

    expect(textB.toString()).toBe("Hello from WorkSphere");
  });
});