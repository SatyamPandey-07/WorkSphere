import React, { useRef, useState } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import YPartyKitProvider from "y-partykit/provider";
import {
  SnapshotManager,
  createHttpSnapshotStorage,
} from "@/lib/crdt/snapshotManager";

interface UserPresence {
  name: string;
  color: string;
}

interface MonacoCollaborativeEditorProps {
  roomId: string;
  user: UserPresence;
  initialLanguage?: string;
  theme?: string;
  partykitHost?: string;
}

export const MonacoCollaborativeEditor: React.FC<
  MonacoCollaborativeEditorProps
> = ({
  roomId,
  user,
  initialLanguage = "typescript",
  theme = "vs-dark",
  partykitHost = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999",
}) => {
  const editorRef = useRef<any>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const handleEditorDidMount: OnMount = (editor, _monaco) => {
    editorRef.current = editor;

    // 1. Initialize Yjs document and text type
    const doc = new Y.Doc();
    // Reclaim deleted nodes/inserts between checkpoints; without this the
    // document retains tombstones for the lifetime of a long session.
    doc.gc = true;
    const yText = doc.getText("monaco");

    // Periodically fold thousands of updates into one compact snapshot and
    // purge the superseded delta log so memory stays bounded (#7574).
    const snapshotManager = new SnapshotManager({
      doc,
      roomId,
      storage: createHttpSnapshotStorage(),
    });
    snapshotManager.start();

    // 2. Setup PartyKit Provider for real-time CRDT sync
    const provider = new YPartyKitProvider(partykitHost, roomId, doc, {
      connect: true,
    });

    // 3. Set up awareness state for remote cursors, names, and avatar ribbons
    const awareness = provider.awareness;
    awareness.setLocalStateField("user", {
      name: user.name,
      color: user.color,
    });

    provider.on("status", (event: { status: string }) => {
      setIsConnected(event.status === "connected");
    });

    // 4. Bind Yjs model and Awareness to Monaco Editor instance
    const model = editor.getModel();
    if (!model) return;

    const binding = new MonacoBinding(
      yText,
      model,
      new Set([editor]),
      awareness,
    );

    // Dynamic style injection for remote user cursor ribbons
    const styleElement = document.createElement("style");
    document.head.appendChild(styleElement);

    const updateCursorStyles = () => {
      const states = awareness.getStates();
      let cssRules = "";

      states.forEach((clientState: any, clientId: number) => {
        if (clientState.user && clientId !== doc.clientID) {
          const { color, name } = clientState.user;
          cssRules += `
            .yRemoteSelection-${clientId} {
              background-color: ${color}40;
            }
            .yRemoteSelectionHead-${clientId} {
              border-left: 2px solid ${color};
              border-top: 2px solid ${color};
              position: relative;
            }
            .yRemoteSelectionHead-${clientId}::after {
              content: '${name}';
              position: absolute;
              top: -1.4em;
              left: -2px;
              background: ${color};
              color: #ffffff;
              font-size: 10px;
              font-weight: 600;
              padding: 1px 4px;
              border-radius: 3px 3px 3px 0;
              white-space: nowrap;
              pointer-events: none;
              z-index: 10;
            }
          `;
        }
      });
      styleElement.innerHTML = cssRules;
    };

    awareness.on("change", updateCursorStyles);

    // Clean up connections, bindings, and dynamic styles on unmount
    return () => {
      awareness.off("change", updateCursorStyles);
      styleElement.remove();
      binding.destroy();
      provider.disconnect();
      void snapshotManager.destroy();
      doc.destroy();
    };
  };

  return (
    <div className="relative w-full h-full flex flex-col border border-slate-800 rounded-lg overflow-hidden bg-[#1e1e1e]">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
            }`}
          />
          <span>{isConnected ? "Live Session" : "Connecting..."}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full inline-block"
            style={{ backgroundColor: user.color }}
          />
          <span className="font-medium text-slate-200">{user.name}</span>
        </div>
      </div>

      <div className="flex-1 min-h-[500px]">
        <Editor
          height="100%"
          defaultLanguage={initialLanguage}
          theme={theme}
          onMount={handleEditorDidMount}
          options={{
            automaticLayout: true,
            fontSize: 14,
            tabSize: 2,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
          }}
        />
      </div>
    </div>
  );
};

export default MonacoCollaborativeEditor;
