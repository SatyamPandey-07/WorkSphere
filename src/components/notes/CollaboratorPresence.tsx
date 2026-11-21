"use client";

import React, { useState } from "react";
import type { AwarenessPeer } from "./GroupNotesEditor";

export interface CollaboratorPresenceProps {
  peers: AwarenessPeer[];
  className?: string;
}

/**
 * Active collaborator avatars and presence indicators in the notes toolbar (#7843).
 *
 * Requirements:
 * - Excludes current user (passed filtered peers).
 * - Gracefully handles missing names (fallback to "Collaborator X").
 * - Gracefully handles missing avatar images (fallback to initial circle).
 * - Deduplicates peer instances.
 * - Accessible tooltips and labels.
 */
export function CollaboratorPresence({
  peers,
  className = "",
}: CollaboratorPresenceProps) {
  const uniquePeers = React.useMemo(() => {
    const seen = new Set<number>();
    const result: AwarenessPeer[] = [];
    for (const peer of peers) {
      if (!seen.has(peer.clientId)) {
        seen.add(peer.clientId);
        result.push(peer);
      }
    }
    return result;
  }, [peers]);

  if (uniquePeers.length === 0) {
    return null;
  }

  return (
    <div
      role="group"
      aria-label="Active collaborators"
      data-testid="awareness-cursors-bar"
      className={`flex items-center gap-1.5 ${className}`}
    >
      {uniquePeers.map((peer) => (
        <CollaboratorAvatar key={peer.clientId} peer={peer} />
      ))}
    </div>
  );
}

function CollaboratorAvatar({ peer }: { peer: AwarenessPeer }) {
  const [imageError, setImageError] = useState(false);
  const displayName = peer.name?.trim() || `User ${peer.clientId}`;
  const initial = displayName.charAt(0).toUpperCase() || "?";

  return (
    <span
      title={displayName}
      aria-label={`Collaborator: ${displayName}`}
      style={{ borderColor: peer.color }}
      className="inline-flex items-center gap-1 rounded-full border bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
    >
      {peer.avatarUrl && !imageError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={peer.avatarUrl}
          alt={displayName}
          onError={() => setImageError(true)}
          className="h-3.5 w-3.5 rounded-full object-cover"
        />
      ) : (
        <span
          style={{ backgroundColor: peer.color }}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
        >
          {initial}
        </span>
      )}
      <span>{displayName}</span>
      {typeof peer.cursorIndex === "number" && (
        <span className="text-[9px] text-zinc-400">@{peer.cursorIndex}</span>
      )}
    </span>
  );
}

export default CollaboratorPresence;
