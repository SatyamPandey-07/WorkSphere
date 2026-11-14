/**
 * diffSyncWorker.ts
 * Web Worker that parses AST-level code diffs and compacts binary CRDT updates
 * with zero-copy Transferable ownership and explicit buffer release in finally blocks.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface DiffPayload {
  fileId: string;
  original: string;
  modified: string;
  language: string;
}

interface BinaryBatchPayload {
  batchId: string;
  updates: Uint8Array[];
}

interface SyncMessage {
  type:
    "COMPUTE_DIFF" | "APPLY_PATCH" | "MERGE_CONFLICT" | "COMPACT_BINARY_BATCH";
  payload: any;
}

self.addEventListener("message", (event: MessageEvent<SyncMessage>) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case "COMPUTE_DIFF":
        computeDiff(payload);
        break;
      case "APPLY_PATCH":
        applyPatch(payload);
        break;
      case "MERGE_CONFLICT":
        resolveConflict(payload);
        break;
      case "COMPACT_BINARY_BATCH":
        compactBinaryBatch(payload);
        break;
    }
  } finally {
    if (payload && Array.isArray(payload.updates)) {
      payload.updates.length = 0;
    }
  }
});

function compactBinaryBatch(data: BinaryBatchPayload) {
  let chunks: Uint8Array[] | null = Array.isArray(data?.updates)
    ? data.updates
    : null;
  let compacted: Uint8Array | null = null;

  try {
    if (!chunks || chunks.length === 0) {
      self.postMessage({
        type: "BINARY_BATCH_COMPACTED",
        batchId: data?.batchId ?? "",
        payload: new Uint8Array(0),
      });
      return;
    }

    let totalLength = 0;
    for (let i = 0; i < chunks.length; i++) {
      totalLength += chunks[i].byteLength;
    }

    compacted = new Uint8Array(totalLength);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      compacted.set(chunks[i], offset);
      offset += chunks[i].byteLength;
      chunks[i] = null as unknown as Uint8Array;
    }

    const transferBuffer = compacted.buffer;
    self.postMessage(
      {
        type: "BINARY_BATCH_COMPACTED",
        batchId: data.batchId,
        payload: compacted,
      },
      [transferBuffer],
    );
  } finally {
    if (chunks) {
      chunks.length = 0;
      chunks = null;
    }
    compacted = null;
  }
}

function computeDiff(data: DiffPayload) {
  const originalLines = data.original.split("\n");
  const modifiedLines = data.modified.split("\n");

  const lcs = longestCommonSubsequence(originalLines, modifiedLines);
  const patches: any[] = [];

  let i = 0,
    j = 0,
    k = 0;

  while (i < originalLines.length || j < modifiedLines.length) {
    if (
      i < originalLines.length &&
      j < modifiedLines.length &&
      originalLines[i] === modifiedLines[j] &&
      (k >= lcs.length || originalLines[i] !== lcs[k])
    ) {
      i++;
      j++;
    } else if (
      i < originalLines.length &&
      (k >= lcs.length || originalLines[i] !== lcs[k])
    ) {
      patches.push({ type: "DELETE", line: i, content: originalLines[i] });
      i++;
    } else if (
      j < modifiedLines.length &&
      (k >= lcs.length || modifiedLines[j] !== lcs[k])
    ) {
      patches.push({ type: "INSERT", line: j, content: modifiedLines[j] });
      j++;
    } else {
      patches.push({ type: "KEEP", line: i, content: originalLines[i] });
      i++;
      j++;
      k++;
    }
  }

  self.postMessage({
    type: "DIFF_COMPUTED",
    fileId: data.fileId,
    patches,
    stats: {
      insertions: patches.filter((p) => p.type === "INSERT").length,
      deletions: patches.filter((p) => p.type === "DELETE").length,
    },
  });
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: string[] = [];
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

function applyPatch(data: { fileId: string; base: string; patches: any[] }) {
  const lines = data.base.split("\n");
  let offset = 0;

  for (const patch of data.patches) {
    const idx = patch.line + offset;
    if (patch.type === "INSERT") {
      lines.splice(idx, 0, patch.content);
      offset++;
    } else if (patch.type === "DELETE") {
      lines.splice(idx, 1);
      offset--;
    }
  }

  self.postMessage({
    type: "PATCH_APPLIED",
    fileId: data.fileId,
    result: lines.join("\n"),
  });
}

function resolveConflict(data: {
  fileId: string;
  ours: string;
  theirs: string;
}) {
  const conflictMarkers = `<<<<<<< OURS\n${data.ours}\n=======\n${data.theirs}\n>>>>>>> THEIRS`;

  self.postMessage({
    type: "CONFLICT_GENERATED",
    fileId: data.fileId,
    content: conflictMarkers,
  });
}

export {};
