/**
 * diffSyncWorker.ts
 * Web Worker that parses AST-level code diffs and serializes them 
 * for low-latency broadcasting to peers.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface DiffPayload {
    fileId: string;
    original: string;
    modified: string;
    language: string;
}

interface SyncMessage {
    type: 'COMPUTE_DIFF' | 'APPLY_PATCH' | 'MERGE_CONFLICT';
    payload: any;
}

self.addEventListener('message', (event: MessageEvent<SyncMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'COMPUTE_DIFF':
            computeDiff(payload);
            break;
        case 'APPLY_PATCH':
            applyPatch(payload);
            break;
        case 'MERGE_CONFLICT':
            resolveConflict(payload);
            break;
    }
});

function computeDiff(data: DiffPayload) {
    // Simplified Myers diff algorithm implementation for text
    const originalLines = data.original.split('\n');
    const modifiedLines = data.modified.split('\n');

    const lcs = longestCommonSubsequence(originalLines, modifiedLines);
    const patches: any[] = [];

    let i = 0, j = 0, k = 0;

    while (i < originalLines.length || j < modifiedLines.length) {
        if (i < originalLines.length && j < modifiedLines.length &&
            originalLines[i] === modifiedLines[j] &&
            (k >= lcs.length || originalLines[i] !== lcs[k])) {
            // Lines match but not in LCS (shouldn't happen in perfect LCS, but handling edge cases)
            i++; j++;
        } else if (i < originalLines.length && (k >= lcs.length || originalLines[i] !== lcs[k])) {
            patches.push({ type: 'DELETE', line: i, content: originalLines[i] });
            i++;
        } else if (j < modifiedLines.length && (k >= lcs.length || modifiedLines[j] !== lcs[k])) {
            patches.push({ type: 'INSERT', line: j, content: modifiedLines[j] });
            j++;
        } else {
            patches.push({ type: 'KEEP', line: i, content: originalLines[i] });
            i++; j++; k++;
        }
    }

    self.postMessage({
        type: 'DIFF_COMPUTED',
        fileId: data.fileId,
        patches,
        stats: {
            insertions: patches.filter(p => p.type === 'INSERT').length,
            deletions: patches.filter(p => p.type === 'DELETE').length
        }
    });
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

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
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            lcs.unshift(a[i - 1]);
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    return lcs;
}

function applyPatch(data: { fileId: string; base: string; patches: any[] }) {
    let lines = data.base.split('\n');
    let offset = 0;

    for (const patch of data.patches) {
        const idx = patch.line + offset;
        if (patch.type === 'INSERT') {
            lines.splice(idx, 0, patch.content);
            offset++;
        } else if (patch.type === 'DELETE') {
            lines.splice(idx, 1);
            offset--;
        }
    }

    self.postMessage({
        type: 'PATCH_APPLIED',
        fileId: data.fileId,
        result: lines.join('\n')
    });
}

function resolveConflict(data: { fileId: string; ours: string; theirs: string }) {
    // Mock 3-way merge conflict resolution
    const conflictMarkers = `<<<<<<< OURS\n${data.ours}\n=======\n${data.theirs}\n>>>>>>> THEIRS`;

    self.postMessage({
        type: 'CONFLICT_GENERATED',
        fileId: data.fileId,
        content: conflictMarkers
    });
}
