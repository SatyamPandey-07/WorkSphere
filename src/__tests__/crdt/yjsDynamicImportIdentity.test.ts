import * as Y from "yjs";

describe("Yjs constructor identity across collaborative client imports", () => {
  it("uses the main application's Y.Doc constructor in editor and whiteboard bundles", async () => {
    const [editorBundle, whiteboardBundle] = await Promise.all([
      import("@/components/whiteboard/MonacoCollaborativeEditor"),
      import("@/components/canvas/NomadCollaborativeCanvas"),
    ]);

    expect(editorBundle.yjsDocConstructor).toBe(Y.Doc);
    expect(whiteboardBundle.yjsDocConstructor).toBe(Y.Doc);
  });
});
