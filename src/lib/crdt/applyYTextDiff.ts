/**
 * Prefix/suffix diff helper for applying local edits to Y.Text
 * without wiping the whole document (required for concurrent CRDT merges).
 */

import type * as Y from "yjs";

export function applyYTextDiff(ytext: Y.Text, next: string): void {
  const prev = ytext.toString();
  if (prev === next) return;

  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1;
  }

  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start &&
    endNext > start &&
    prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)
  ) {
    endPrev -= 1;
    endNext -= 1;
  }

  const doc = ytext.doc;
  const run = () => {
    const deleteLen = endPrev - start;
    if (deleteLen > 0) ytext.delete(start, deleteLen);
    const insert = next.slice(start, endNext);
    if (insert.length > 0) ytext.insert(start, insert);
  };

  if (doc) doc.transact(run, "local-editor");
  else run();
}
