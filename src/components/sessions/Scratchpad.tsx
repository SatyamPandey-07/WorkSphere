"use client";

import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";
import usePartySocket from "partysocket/react";
import { CryptoManager } from "@/lib/e2ee/CryptoManager";
import { KeyStore } from "@/lib/e2ee/KeyStore";
import { Lock, Unlock, Key, Loader2, Share2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  KeyPair,
} from "@/lib/p2p/encryption";

interface Props {
  sessionId: string;
}

const keyStore = new KeyStore();

export default function Scratchpad({ sessionId }: Props) {
  const [hasKey, setHasKey] = useState(false);
  const [isNegotiating, setIsNegotiating] = useState(false);
  const [text, setText] = useState("");
  const { toast } = useToast();
  
  const clientId = useRef(crypto.randomUUID());
  const ecdhKeyPair = useRef<KeyPair | null>(null);

  const docRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  const isLocalUpdateRef = useRef(false);
  const processedUpdatesRef = useRef<Set<string>>(new Set());
  const updateQueueRef = useRef<Uint8Array[]>([]);
  const isApplyingRef = useRef(false);

  const processQueue = () => {
    if (isApplyingRef.current || !docRef.current) return;
    isApplyingRef.current = true;

    try {
      docRef.current.transact(() => {
        while (updateQueueRef.current.length > 0) {
          const update = updateQueueRef.current.shift();
          if (update) {
            Y.applyUpdate(docRef.current!, update);
          }
        }
      });
    } finally {
      isApplyingRef.current = false;
    }
  };

  // Initialize Y.Doc
  useEffect(() => {
    const doc = new Y.Doc();
    const ytext = doc.getText("scratchpad");
    docRef.current = doc;
    yTextRef.current = ytext;

    ytext.observe(() => {
      setText(ytext.toString());
    });

    return () => {
      doc.destroy();
    };
  }, []);

  // Check IndexedDB for existing key
  useEffect(() => {
    async function checkKey() {
      const stored = await keyStore.getSessionKey(sessionId);
      if (stored) {
        cryptoKeyRef.current = stored.key;
        setHasKey(true);
      } else {
        // Generate ECDH key pair for negotiation
        ecdhKeyPair.current = await generateKeyPair();
        setIsNegotiating(true);
      }
    }
    checkKey();
  }, [sessionId]);

  const socket = usePartySocket({
    room: `session-scratchpad-${sessionId}`,
    onMessage: async (e) => {
      try {
        const msg = JSON.parse(e.data);

        // Handle incoming E2EE delta updates
        if (
          msg.type === "e2ee-delta" &&
          cryptoKeyRef.current &&
          docRef.current
        ) {
          const { ciphertext, iv } = msg.payload;
          const decryptedUpdate = await CryptoManager.decryptPayload(
            cryptoKeyRef.current,
            ciphertext,
            iv,
          );

          const hash = Array.from(decryptedUpdate)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          if (processedUpdatesRef.current.has(hash)) {
            return;
          }
          processedUpdatesRef.current.add(hash);

          updateQueueRef.current.push(decryptedUpdate);

          isLocalUpdateRef.current = true;
          processQueue();
          isLocalUpdateRef.current = false;
          return;
        }

        // Handle incoming request for the group key (we are an existing peer)
        if (msg.type === "e2ee-request-key" && hasKey && cryptoKeyRef.current) {
          const peerPubKey = await importPublicKey(msg.publicKey);
          const tempPair = await generateKeyPair();
          const sharedKey = await deriveSharedKey(
            tempPair.privateKey,
            peerPubKey,
          );

          const rawGroupKey = await window.crypto.subtle.exportKey(
            "raw",
            cryptoKeyRef.current,
          );
          const encryptedGroupKey = await CryptoManager.encryptPayload(
            sharedKey,
            new Uint8Array(rawGroupKey),
          );

          const myPubKeyBase64 = await exportPublicKey(tempPair.publicKey);
          socket.send(
            JSON.stringify({
              type: "e2ee-share-key",
              targetClientId: msg.clientId,
              senderPublicKey: myPubKeyBase64,
              encryptedKey: encryptedGroupKey,
            }),
          );
          return;
        }

        // Handle receiving the group key (we are the new peer)
        if (
          msg.type === "e2ee-share-key" &&
          msg.targetClientId === clientId.current &&
          isNegotiating
        ) {
          const peerPubKey = await importPublicKey(msg.senderPublicKey);
          const sharedKey = await deriveSharedKey(
            ecdhKeyPair.current!.privateKey,
            peerPubKey,
          );

          const decryptedRawKey = await CryptoManager.decryptPayload(
            sharedKey,
            msg.encryptedKey.ciphertext,
            msg.encryptedKey.iv,
          );
          const groupKey = await window.crypto.subtle.importKey(
            "raw",
            decryptedRawKey as BufferSource,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"],
          );

          cryptoKeyRef.current = groupKey;
          await keyStore.saveSessionKey(sessionId, groupKey, new Uint8Array(0));
          setHasKey(true);
          setIsNegotiating(false);
          return;
        }
      } catch {
        // Ignore non-json or decryption errors
      }
    },
  });

  // Start negotiation when socket is open
  useEffect(() => {
    if (
      isNegotiating &&
      ecdhKeyPair.current &&
      socket.readyState === WebSocket.OPEN
    ) {
      exportPublicKey(ecdhKeyPair.current.publicKey).then((pubKeyStr) => {
        socket.send(
          JSON.stringify({
            type: "e2ee-request-key",
            clientId: clientId.current,
            publicKey: pubKeyStr,
          }),
        );

        // Fallback: If no one responds in 3 seconds, generate a fresh group key
        setTimeout(async () => {
          if (!cryptoKeyRef.current) {
            const newGroupKey = await window.crypto.subtle.generateKey(
              { name: "AES-GCM", length: 256 },
              true,
              ["encrypt", "decrypt"],
            );
            cryptoKeyRef.current = newGroupKey;
            await keyStore.saveSessionKey(
              sessionId,
              newGroupKey,
              new Uint8Array(0),
            );
            setHasKey(true);
            setIsNegotiating(false);
          }
        }, 3000);
      });
    }
  }, [isNegotiating, socket.readyState, socket, sessionId]);

  // Handle local Yjs updates and encrypt them
  useEffect(() => {
    if (!docRef.current) return;

    const doc = docRef.current;
    const handleUpdate = async (update: Uint8Array, _origin: any) => {
      if (isLocalUpdateRef.current || !cryptoKeyRef.current) return;

      try {
        const hash = Array.from(update)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        processedUpdatesRef.current.add(hash);

        const encrypted = await CryptoManager.encryptPayload(
          cryptoKeyRef.current,
          update,
        );
        socket.send(
          JSON.stringify({
            type: "e2ee-delta",
            payload: encrypted,
          }),
        );
      } catch (err) {
        console.error("Failed to encrypt/send update", err);
      }
    };

    doc.on("update", handleUpdate);
    return () => {
      doc.off("update", handleUpdate);
    };
  }, [socket, hasKey]);
  const handleShare = async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast("Scratchpad link copied to clipboard!", "success");
  } catch (error) {
    console.error("Failed to copy scratchpad link", error);
    toast("Failed to copy scratchpad link.", "error");
  }
};



  const handleClearKey = async () => {
    await keyStore.deleteSessionKey(sessionId);
    cryptoKeyRef.current = null;
    setHasKey(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!yTextRef.current || !docRef.current) return;
    const ytext = yTextRef.current;

    // Simple diffing logic to apply changes to Yjs
    const newValue = e.target.value;
    const oldValue = ytext.toString();

    // Find common prefix
    let start = 0;
    while (
      start < oldValue.length &&
      start < newValue.length &&
      oldValue[start] === newValue[start]
    ) {
      start++;
    }

    // Find common suffix
    let endOld = oldValue.length - 1;
    let endNew = newValue.length - 1;
    while (
      endOld >= start &&
      endNew >= start &&
      oldValue[endOld] === newValue[endNew]
    ) {
      endOld--;
      endNew--;
    }

    const removeCount = endOld - start + 1;
    const insertString = newValue.slice(start, endNew + 1);

    docRef.current.transact(() => {
      if (removeCount > 0) {
        ytext.delete(start, removeCount);
      }
      if (insertString.length > 0) {
        ytext.insert(start, insertString);
      }
    });
  };

  if (!hasKey || isNegotiating) {
    return (
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 flex flex-col items-center justify-center text-center h-[400px]">
        <div className="mb-4 rounded-full bg-violet-500/10 p-4 text-violet-300">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
        <h3 className="text-xl font-semibold text-white">
          Establishing Secure Connection
        </h3>
        <p className="mt-2 text-sm text-zinc-400 mb-6 max-w-sm">
          Exchanging ECDH cryptographic keys with peers to seamlessly encrypt
          your scratchpad.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] flex flex-col h-[400px] overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-center gap-2 text-violet-300">
          <Unlock className="h-4 w-4" />
          <span className="text-sm font-medium">E2EE Scratchpad</span>
        </div>
        <div className="flex items-center gap-2">
  <button
    onClick={handleShare}
    className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
  >
    <Share2 className="h-3 w-3" />
    Share
  </button>

  <button
    onClick={handleClearKey}
    className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
  >
    <Key className="h-3 w-3" />
    Clear Key
  </button>
</div>
        
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={text}
          onChange={handleChange}
          placeholder="Start typing securely..."
          className="h-full w-full resize-none bg-transparent text-white outline-none placeholder:text-zinc-600 font-mono text-sm"
        />
      </div>
    </div>
  );
}
