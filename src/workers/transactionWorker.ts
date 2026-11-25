/**
 * transactionWorker.ts
 * Web Worker that handles the heavy cryptographic verification of
 * payment webhooks and updates the local expense ledger.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

export interface WorkerMessage {
  type: "VERIFY_WEBHOOK" | "HASH_RECEIPT" | "SYNC_LEDGER";
  payload: any;
}

// Mock Ledger State
const localLedger: any[] = [];

function postWorkerResponse(message: any) {
  if (typeof self !== "undefined" && typeof self.postMessage === "function") {
    try {
      // DedicatedWorkerGlobalScope.postMessage accepts a message object.
      // When run inside jest/jsdom where self === window, window.postMessage requires (message, targetOrigin).
      if (
        typeof (self as any).importScripts === "function" ||
        typeof (self as any).DedicatedWorkerGlobalScope !== "undefined"
      ) {
        self.postMessage(message);
      } else {
        // Window/JSDOM context fallback: try single argument first, then fallback to targetOrigin
        try {
          self.postMessage(message);
        } catch {
          self.postMessage(message, "*");
        }
      }
    } catch {
      try {
        self.postMessage(message);
      } catch {
        // Ignore environment-specific postMessage errors
      }
    }
  }
}

if (
  typeof self !== "undefined" &&
  typeof self.addEventListener === "function"
) {
  self.addEventListener(
    "message",
    async (event: MessageEvent<WorkerMessage>) => {
      const { type, payload } = event.data;

      try {
        switch (type) {
          case "VERIFY_WEBHOOK":
            await verifyWebhookSignature(payload);
            break;
          case "HASH_RECEIPT":
            await hashReceiptImage(payload);
            break;
          case "SYNC_LEDGER":
            syncLedger(payload);
            break;
        }
      } catch (error: any) {
        postWorkerResponse({
          type: "ERROR",
          error: error?.message ?? String(error),
        });
      }
    },
  );
}

/**
 * Decodes a 64-character lowercase or uppercase hex string into a 32-byte Uint8Array.
 * Returns null if the string is malformed or not exactly 64 hex characters (32 bytes).
 */
export function decodeHexSignature(
  hex: unknown,
): Uint8Array<ArrayBuffer> | null {
  if (typeof hex !== "string") {
    return null;
  }
  if (hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      return null;
    }
    bytes[i] = byte;
  }
  return bytes;
}

export async function verifyWebhookSignature(payload: {
  body: string;
  signature: string;
  secret: string;
}): Promise<boolean> {
  if (
    !payload ||
    typeof payload.body !== "string" ||
    typeof payload.signature !== "string" ||
    typeof payload.secret !== "string" ||
    payload.secret.length === 0
  ) {
    postWorkerResponse({
      type: "WEBHOOK_VERIFIED",
      isValid: false,
    });
    return false;
  }

  const signatureBytes = decodeHexSignature(payload.signature);
  if (!signatureBytes) {
    postWorkerResponse({
      type: "WEBHOOK_VERIFIED",
      isValid: false,
    });
    return false;
  }

  let isValid = false;
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload.body);

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(payload.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, data);
  } catch {
    isValid = false;
  }

  postWorkerResponse({
    type: "WEBHOOK_VERIFIED",
    isValid,
  });

  return isValid;
}

export async function hashReceiptImage(payload: {
  imageData: ArrayBuffer;
  receiptId: string;
}) {
  // Hash the raw image data to create an immutable receipt fingerprint
  const hashBuffer = await crypto.subtle.digest("SHA-256", payload.imageData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  postWorkerResponse({
    type: "RECEIPT_HASHED",
    receiptId: payload.receiptId,
    hash: hashHex,
  });
  return hashHex;
}

export function syncLedger(payload: { entries: any[] }) {
  // Append to local ledger and calculate Merkle root for the batch
  for (const entry of payload.entries) {
    localLedger.push(entry);
  }

  // Simple Merkle root calculation for the batch
  const root = calculateMerkleRoot(
    payload.entries.map((e) => JSON.stringify(e)),
  );

  postWorkerResponse({
    type: "LEDGER_SYNCED",
    totalEntries: localLedger.length,
    batchRoot: root,
  });
  return root;
}

export function calculateMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return "";
  if (leaves.length === 1) return leaves[0];

  // Synchronous mock hash for worker context (real impl uses SubtleCrypto async)
  const hash = (str: string) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return h.toString(16);
  };

  let currentLevel = leaves.map((l) => hash(l));

  while (currentLevel.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(hash(left + right));
    }
    currentLevel = nextLevel;
  }

  return currentLevel[0];
}
export {};
