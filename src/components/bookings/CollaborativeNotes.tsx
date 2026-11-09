"use client";

/**
 * Venue / booking shared notes — wraps the offline-first CRDT group editor (#1023).
 */

import { GroupNotesEditor } from "@/components/notes/GroupNotesEditor";

interface CollaborativeNotesProps {
  roomId: string;
  placeholder?: string;
  venueName?: string;
}

export function CollaborativeNotes({
  roomId,
  placeholder = "Type meeting notes here...",
  venueName,
}: CollaborativeNotesProps) {
  return (
    <GroupNotesEditor
      roomId={roomId}
      placeholder={placeholder}
      textKey="booking-notes"
      venueName={venueName}
    />
  );
}
