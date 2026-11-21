# Group Notes Collaboration Guide

This guide covers the shared notes editor `GroupNotesEditor` (`src/components/notes/GroupNotesEditor.tsx`): how a note is stored as a Yjs document, how it syncs through PartyKit, how presence cursors work, and how edits survive going offline. The last section explains how to run it locally.

The venue page uses it through `src/components/bookings/CollaborativeNotes.tsx`:

```tsx
<CollaborativeNotes roomId={venue.id} venueName={venue.name} />
```

Collection (folder) notes use a different editor, `CollectionNotesEditor`, with members-only rooms. That editor is described in [docs/components/collaborative-notes-guide.md](../components/collaborative-notes-guide.md).

## Where things live

| Part                                  | File                                                                                                 |
| :------------------------------------ | :--------------------------------------------------------------------------------------------------- |
| Editor component                      | `src/components/notes/GroupNotesEditor.tsx`                                                          |
| Venue wrapper                         | `src/components/bookings/CollaborativeNotes.tsx`                                                     |
| Offline outbox and document snapshots | `src/lib/crdt/notesOutbox.ts`                                                                        |
| Diff from the text box into Y.Text    | `src/lib/crdt/applyYTextDiff.ts`                                                                     |
| Presence UI                           | `src/components/notes/CollaboratorPresence.tsx`, `ConnectionStatusPill.tsx`, `OfflineSyncBanner.tsx` |
| PartyKit server                       | `party/server.ts` (the `main` entry in `partykit.json`)                                              |
| Room access check                     | `src/app/api/partykit/auth/route.ts`                                                                 |

There is no separate `party/notes.ts`: notes rooms are handled by the default party in `party/server.ts`.

## The Yjs document

Each note is one `Y.Doc` holding a single shared `Y.Text`:

| Prop      | Default         | Meaning                                                                      |
| :-------- | :-------------- | :--------------------------------------------------------------------------- |
| `roomId`  | required        | Identifies the note. The PartyKit room is `notes-{roomId}`.                  |
| `textKey` | `"group-notes"` | Name of the `Y.Text` inside the document. Venue notes use `"booking-notes"`. |

The editor is a `contenteditable` element. On input, `applyYTextDiff` turns the change into Y.Text inserts and deletes; when the Y.Text changes (remote edit or local load), the editor's text is replaced. A flag (`applyingRemoteRef`) stops a remote change from being sent back as a new local edit.

## Syncing through PartyKit

The editor connects with `y-partykit`:

```ts
new YPartyKitProvider(host, `notes-${roomId}`, ydoc, {
  params: async () => ({ token: (await getToken()) ?? "" }),
});
```

- `host` is `NEXT_PUBLIC_PARTYKIT_HOST`, or `127.0.0.1:1999` when it is not set.
- `params` runs on every (re)connect, so each connection carries a fresh Clerk session token.

y-partykit uses the standard Yjs sync protocol:

1. **Sync step 1.** On connect, each side sends its _state vector_: for every client that has edited the document, the number of operations it has seen from that client.
2. **Sync step 2.** Each side replies with only the operations the other is missing, computed from that state vector.
3. **Updates.** After that, every local change is sent as an incremental update and applied by the others. Yjs merges concurrent edits deterministically, so all copies converge without a central lock.

### What the server does

`onConnect` in `party/server.ts` decides whether the connection may write:

1. Without a `token` query parameter, the connection is a **viewer**.
2. With a token, the server verifies it with Clerk (`CLERK_SECRET_KEY`). A token that fails verification closes the connection with code `4001`.
3. In `notes-` rooms (prefix `GROUP_NOTES_ROOM_PREFIX`) and `canvas-` rooms, a verified token is enough to edit; there is no further lookup.
4. In other rooms the server asks `${NEXT_PUBLIC_APP_URL}/api/partykit/auth` for the user's role in the folder the room maps to, sending `PARTYKIT_AUTH_SECRET` (or `PARTYKIT_SHARED_SECRET`) as a bearer token. A `VIEWER` or `MEMBER` role, or a failed lookup, makes the connection a viewer.
5. y-partykit's `onConnect` is called with `readOnly: isViewer`. A read-only connection receives everyone's edits, but y-partykit drops the edits it sends.

Notes rooms use `gc: true` and are **not persisted** by the server: the document lives in the room's memory while people are connected. When a room has been idle and is unloaded, the next visitor's copy comes from their browser (see below). Collection notes rooms (`folder-notes-*`) are different: they use `persist: { mode: "snapshot" }` and only folder members may join.

## Presence and cursors (awareness)

Presence uses the Yjs _awareness_ protocol, which y-partykit relays alongside document updates. Awareness state is not part of the document and is not stored.

Each client sets one field:

```ts
awareness.setLocalStateField("user", {
  name, // currentUser.name, or "Coworker"
  avatarUrl, // optional
  color, // currentUser.color, or a colour picked from roomId
  cursorIndex, // caret offset in the text
});
```

- `cursorIndex` is updated as the caret moves.
- On every awareness `change` event the editor rebuilds the list of other clients from `awareness.getStates()`, skipping its own `clientID`. A peer without a name is shown as `Collaborator {clientId}`, and one without a colour gets one from the palette by `clientId`.
- `CollaboratorPresence` renders those peers.

## Offline editing

Two IndexedDB stores keep notes usable without a connection.

**1. y-indexeddb.** `new IndexeddbPersistence("worksphere-notes-{roomId}", ydoc)` stores every document update in the browser. When it reports `synced`, the editor shows the stored text, so a note opens instantly and offline. When IndexedDB is not available (for example some private browsing modes), the editor still works but nothing is kept locally.

**2. The notes outbox** (`src/lib/crdt/notesOutbox.ts`). This is database `worksphere-crdt-notes`, version 1, with two stores:

| Store       | Key                                  | Contents                                                                                |
| :---------- | :----------------------------------- | :-------------------------------------------------------------------------------------- |
| `outbox`    | auto-increment `id`, index `by-room` | `{ roomId, update, createdAt }`: local updates made while the WebSocket was closed      |
| `documents` | `roomId`                             | `{ roomId, state, updatedAt }`: a full snapshot of the document after each local change |

The flow:

1. Every local change (any update whose origin is not `remote`, `outbox-flush` or `idb-load`) saves a snapshot to `documents`.
2. If the WebSocket is not open at that moment, the update is also added to `outbox` and the "unsynced edits" counter goes up.
3. When the provider reports `connected` or `synced`, the editor calls `flushNotesOutbox(roomId, ydoc, textKey)`.
4. For each queued update it compares the text before and after applying it. Updates that do not touch text changed remotely are applied and removed from the outbox. Updates that would change text that was also changed remotely are returned as **conflicts**.
5. Conflicts raise a toast with a **Review** action. The user picks:
   - **Keep Local**: `resolveConflictsKeepLocal` applies the queued updates;
   - **Use Remote**: `resolveConflictsUseRemote` discards them.

Because Yjs merges are deterministic, "Keep Local" merges both versions rather than overwriting the remote text.

## Running it locally

[docs/partykit-local-setup.md](../partykit-local-setup.md) has the full setup. In short, add to `.env.local`:

```env
NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
PARTYKIT_AUTH_SECRET=any-long-random-string
CLERK_SECRET_KEY=sk_test_...
```

Then start both servers in separate terminals:

```bash
npx partykit dev   # PartyKit on 127.0.0.1:1999
npm run dev        # Next.js on 127.0.0.1:3000
```

The PartyKit process needs `CLERK_SECRET_KEY` and `PARTYKIT_AUTH_SECRET` too, because `party/server.ts` verifies tokens and calls the auth route.

To try collaboration, sign in as two different users in two browsers (or a normal and a private window), open the same venue page and type in the notes. To test offline editing, switch one browser to offline in the developer tools, type, then go back online: the unsynced counter should drop to zero.

### Deploying the PartyKit server

```bash
npx partykit deploy
```

Set the same server-side variables on the PartyKit project (`CLERK_SECRET_KEY`, `PARTYKIT_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`), then point `NEXT_PUBLIC_PARTYKIT_HOST` in the Next.js deployment at the deployed host.

## Troubleshooting

| Symptom                                                       | Likely cause                                                                                                                                                               |
| :------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your edits never appear for others, but theirs appear for you | The connection is read-only. In a notes room that means no token was sent: check that you are signed in and that Clerk is configured in the browser.                       |
| Status pill stays on "Reconnecting"                           | PartyKit is not running, or `NEXT_PUBLIC_PARTYKIT_HOST` points at the wrong host.                                                                                          |
| Connection closes with code `4001`                            | Token verification failed; check `CLERK_SECRET_KEY` in the PartyKit process.                                                                                               |
| Notes are empty after everyone left and came back             | Notes rooms are not persisted on the server; the text comes from the browsers' IndexedDB copies. A browser that never opened the note, or cleared site data, starts empty. |
| Unsynced counter never goes down                              | The WebSocket never reaches `connected`, so the outbox is not flushed.                                                                                                     |
