"use client";

import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { Loader2, Wifi, WifiOff } from "lucide-react";

interface CollaborativeNotesProps {
  roomId: string;
  placeholder?: string;
}

export function CollaborativeNotes({ roomId, placeholder = "Type meeting notes here..." }: CollaborativeNotesProps) {
  const [status, setStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [content, setContent] = useState("");
  
  // Refs to hold our mutable CRDT instances without triggering re-renders
  const yDocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // 1. Initialize the Yjs Document
    const ydoc = new Y.Doc();
    yDocRef.current = ydoc;

    // 2. Define our shared text type
    const ytext = ydoc.getText("booking-notes");
    yTextRef.current = ytext;

    // 3. Connect to PartyKit for real-time sync
    const provider = new YPartyKitProvider(
      process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999",
      roomId,
      ydoc
    );
    providerRef.current = provider;

    // 4. Handle Network Status & Offline Sync
    provider.on("status", (event: { status: string }) => {
      if (event.status === "connected") setStatus("connected");
      else if (event.status === "disconnected") setStatus("offline");
    });

    // 5. Sync Yjs changes to React state so the UI updates
    const observer = () => {
      setContent(ytext.toString());
    };
    ytext.observe(observer);

    // Initial load
    setContent(ytext.toString());

    // Cleanup on unmount
    return () => {
      ytext.unobserve(observer);
      provider.disconnect();
      ydoc.destroy();
    };
  }, [roomId]);

  // Handle local typing and push to Yjs
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ytext = yTextRef.current;
    const textarea = textAreaRef.current;
    
    if (!ytext || !textarea) return;

    const newValue = e.target.value;
    
    // Calculate the difference to only push deltas (changes) to the CRDT
    ydocRef.current?.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, newValue);
    });
  };

  return (
    <div className="w-full flex flex-col gap-2 p-4 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
        <h3 className="text-sm font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
          Shared Agenda & Notes
        </h3>
        
        {/* Real-time Connection Status Indicator */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-50 dark:bg-zinc-900 rounded-md border border-zinc-200 dark:border-zinc-800">
          {status === "connecting" && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
          {status === "connected" && <Wifi className="w-3.5 h-3.5 text-green-500" />}
          {status === "offline" && <WifiOff className="w-3.5 h-3.5 text-orange-500" />}
          
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {status}
          </span>
        </div>
      </div>

      <textarea
        ref={textAreaRef}
        value={content}
        onChange={handleInput}
        placeholder={placeholder}
        disabled={status === "connecting"}
        className="w-full min-h-[150px] p-3 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/50 resize-y transition-shadow placeholder:text-zinc-400 disabled:opacity-50"
      />
      
      {status === "offline" && (
        <p className="text-[10px] font-bold text-orange-500">
          You are offline. Edits will sync automatically when you reconnect.
        </p>
      )}
    </div>
  );
}
