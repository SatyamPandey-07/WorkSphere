# CRDT Multi-User Canvas Whiteboard Conflict-Resolution Guide

This guide documents a recommended Yjs data model and synchronization strategy
for a collaborative WorkSphere canvas or whiteboard.

It covers:

- vector-object schemas using `Y.Map` and `Y.Array`;
- atomic canvas edits through Yjs transactions;
- selective undo and redo;
- real-time cursor and user-presence awareness;
- PartyKit WebSocket synchronization;
- deterministic conflict-resolution behavior;
- persistence, reconnection, validation, and testing.

> This document describes a recommended architecture. The executable source of
> truth remains the application's actual Yjs bindings, PartyKit server, and
> persistence implementation.

---

## 1. Architecture overview

```text
┌──────────────────────────┐
│ React canvas client A    │
│ Y.Doc + awareness        │
└─────────────┬────────────┘
              │ Yjs updates / awareness messages
              ▼
┌──────────────────────────┐
│ PartyKit room            │
│ WebSocket fan-out        │
│ optional update storage  │
└───────┬───────────┬──────┘
        │           │
        ▼           ▼
┌───────────────┐ ┌───────────────┐
│ Canvas client │ │ Canvas client │
│ B             │ │ C             │
└───────────────┘ └───────────────┘
```

Each whiteboard room owns one `Y.Doc`. Every connected client binds its local
canvas UI to the same shared Yjs types. Clients exchange binary Yjs updates
through a PartyKit WebSocket room.

Yjs shared types merge concurrent operations without requiring clients to agree
on a global edit order before editing.

---

## 2. Top-level Yjs document schema

Use stable top-level keys. Changing these names creates a logically different
shared type.

```ts
import * as Y from "yjs";

export function createWhiteboardDocument() {
  const doc = new Y.Doc();

  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const zOrder = doc.getArray<string>("zOrder");
  const pages = doc.getArray<Y.Map<unknown>>("pages");
  const metadata = doc.getMap<unknown>("metadata");

  return {
    doc,
    objects,
    zOrder,
    pages,
    metadata,
  };
}
```

Recommended top-level model:

| Shared type               | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `objects: Y.Map<Y.Map>`   | Object records keyed by stable object ID          |
| `zOrder: Y.Array<string>` | Ordered object IDs from back to front             |
| `pages: Y.Array<Y.Map>`   | Optional multi-page whiteboard metadata           |
| `metadata: Y.Map`         | Board title, version, creation metadata, settings |

### Why separate objects and ordering?

A single `Y.Array` containing complete shape objects appears simple, but causes
more ordering contention and makes property-level edits harder.

The recommended model separates:

1. object identity and mutable properties in `Y.Map`;
2. rendering order in `Y.Array`.

Concurrent color and position edits can then merge independently from
concurrent z-order operations.

---

## 3. Canvas object schema

Each object should be a nested `Y.Map`.

```ts
type CanvasObjectType =
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "freehand"
  | "text"
  | "sticky-note"
  | "image"
  | "group";

function createCanvasObject(input: {
  id: string;
  type: CanvasObjectType;
  userId: string;
  x: number;
  y: number;
}) {
  const object = new Y.Map<unknown>();

  object.set("id", input.id);
  object.set("type", input.type);
  object.set("x", input.x);
  object.set("y", input.y);
  object.set("width", 120);
  object.set("height", 80);
  object.set("rotation", 0);
  object.set("opacity", 1);
  object.set("locked", false);
  object.set("createdBy", input.userId);
  object.set("createdAt", Date.now());
  object.set("updatedAt", Date.now());

  const style = new Y.Map<unknown>();
  style.set("fill", "#ffffff");
  style.set("stroke", "#111827");
  style.set("strokeWidth", 2);
  style.set("fontSize", 16);
  style.set("fontFamily", "Inter");

  object.set("style", style);

  return object;
}
```

Recommended common fields:

| Field             | Type        | Notes                                       |
| ----------------- | ----------- | ------------------------------------------- |
| `id`              | `string`    | Immutable unique identifier                 |
| `type`            | enum string | Rectangle, text, image, freehand, and so on |
| `x`, `y`          | number      | Canvas coordinates                          |
| `width`, `height` | number      | Bounding-box size                           |
| `rotation`        | number      | Degrees or radians; choose one convention   |
| `opacity`         | number      | Clamp between `0` and `1`                   |
| `locked`          | boolean     | UI-level edit restriction                   |
| `createdBy`       | string      | User ID                                     |
| `createdAt`       | number      | Millisecond timestamp                       |
| `updatedAt`       | number      | Display/audit metadata only                 |
| `style`           | `Y.Map`     | Independently mergeable style fields        |

Do not treat wall-clock timestamps as the CRDT conflict-resolution mechanism.
Yjs resolves operations through its own internal causal model.

---

## 4. Freehand and polyline data

Use `Y.Array` for ordered point sequences.

```ts
type PointTuple = [number, number, number?];

function createFreehandObject(input: {
  id: string;
  userId: string;
  points: PointTuple[];
}) {
  const object = createCanvasObject({
    id: input.id,
    type: "freehand",
    userId: input.userId,
    x: 0,
    y: 0,
  });

  const points = new Y.Array<PointTuple>();
  points.push(input.points);

  object.set("points", points);
  object.set("width", 0);
  object.set("height", 0);

  return object;
}
```

A point can contain:

```text
[x, y]
```

or:

```text
[x, y, pressure]
```

### Performance guidance

Do not insert one point per network round trip.

Collect points briefly in the UI and append them in batches:

```ts
doc.transact(() => {
  points.push(bufferedPoints);
}, LOCAL_DRAW_ORIGIN);
```

For very large strokes:

- simplify points before inserting;
- use a binary `Uint8Array` representation where appropriate;
- split exceptionally long strokes;
- avoid reserializing the entire stroke for each pointer event.

---

## 5. Text objects

Use `Y.Text` when users may edit the same text object concurrently.

```ts
function createTextObject(input: { id: string; userId: string; text: string }) {
  const object = createCanvasObject({
    id: input.id,
    type: "text",
    userId: input.userId,
    x: 100,
    y: 100,
  });

  const content = new Y.Text();
  content.insert(0, input.text);

  object.set("content", content);

  return object;
}
```

Do not store collaboratively edited text as one plain string property if
character-level merging is expected.

---

## 6. Adding an object atomically

Add the object record and z-order entry in one transaction.

```ts
const LOCAL_DRAW_ORIGIN = Symbol("local-draw");

function addObject(
  doc: Y.Doc,
  objects: Y.Map<Y.Map<unknown>>,
  zOrder: Y.Array<string>,
  object: Y.Map<unknown>,
) {
  const id = object.get("id");

  if (typeof id !== "string") {
    throw new Error("Canvas object requires an ID");
  }

  doc.transact(() => {
    objects.set(id, object);
    zOrder.push([id]);
  }, LOCAL_DRAW_ORIGIN);
}
```

Using one transaction means observers render one coherent state change rather
than temporarily seeing an object without an ordering entry.

---

## 7. Updating object properties

Update only properties that changed.

```ts
const LOCAL_TRANSFORM_ORIGIN = Symbol("local-transform");

function moveObject(
  doc: Y.Doc,
  objects: Y.Map<Y.Map<unknown>>,
  objectId: string,
  x: number,
  y: number,
) {
  const object = objects.get(objectId);

  if (!object) {
    return;
  }

  doc.transact(() => {
    object.set("x", x);
    object.set("y", y);
    object.set("updatedAt", Date.now());
  }, LOCAL_TRANSFORM_ORIGIN);
}
```

Avoid replacing the entire object with a new plain JSON object. Property-level
shared fields allow independent concurrent changes to merge more usefully.

Bad:

```ts
objects.set(objectId, {
  ...oldObject,
  x,
  y,
});
```

Better:

```ts
object.set("x", x);
object.set("y", y);
```

---

## 8. Object deletion

Delete the object and every z-order reference in one transaction.

```ts
const LOCAL_DELETE_ORIGIN = Symbol("local-delete");

function deleteObject(
  doc: Y.Doc,
  objects: Y.Map<Y.Map<unknown>>,
  zOrder: Y.Array<string>,
  objectId: string,
) {
  doc.transact(() => {
    objects.delete(objectId);

    for (let index = zOrder.length - 1; index >= 0; index -= 1) {
      if (zOrder.get(index) === objectId) {
        zOrder.delete(index, 1);
      }
    }
  }, LOCAL_DELETE_ORIGIN);
}
```

The renderer should also tolerate temporary or legacy dangling IDs by skipping
IDs not found in `objects`.

---

## 9. Rendering the CRDT state

Observe deep object changes and ordering changes.

```ts
function bindWhiteboardRenderer(input: {
  objects: Y.Map<Y.Map<unknown>>;
  zOrder: Y.Array<string>;
  render: (objects: unknown[]) => void;
}) {
  const renderCurrentState = () => {
    const orderedObjects = input.zOrder
      .toArray()
      .map((id) => input.objects.get(id))
      .filter((object): object is Y.Map<unknown> => Boolean(object))
      .map((object) => object.toJSON());

    input.render(orderedObjects);
  };

  input.objects.observeDeep(renderCurrentState);
  input.zOrder.observe(renderCurrentState);
  renderCurrentState();

  return () => {
    input.objects.unobserveDeep(renderCurrentState);
    input.zOrder.unobserve(renderCurrentState);
  };
}
```

For large boards, avoid rerendering every shape after every update. Instead,
inspect event paths and update only affected render nodes.

---

## 10. Conflict-resolution examples

## 10.1 Concurrent edits to different properties

Initial object:

```json
{
  "x": 100,
  "y": 100,
  "fill": "#ffffff"
}
```

Client A changes `x` while Client B changes `fill`.

Because they edit different map keys, the merged object contains both changes:

```json
{
  "x": 250,
  "y": 100,
  "fill": "#2563eb"
}
```

This is a primary reason to use nested shared maps rather than replacing the
whole object.

## 10.2 Concurrent edits to the same property

Client A and Client B both set `x` concurrently.

Yjs deterministically converges on one value across all clients. Applications
should not implement a separate timestamp-based last-write-wins layer on top of
the same property.

For better UX during drag operations:

- show remote movement as it arrives;
- use awareness for temporary drag previews when appropriate;
- commit durable position updates at a controlled frequency;
- indicate when another user is manipulating the same object.

## 10.3 Delete versus update

Client A deletes an object while Client B updates it concurrently.

The final result depends on the CRDT operation relationship, but all clients
will converge. The application must tolerate:

- update observers firing near deletion;
- stale selection state referring to a deleted object;
- awareness states pointing to a removed object.

When an object disappears:

```ts
if (!objects.has(selectedObjectId)) {
  clearLocalSelection();
}
```

## 10.4 Concurrent z-order changes

Two users may move objects to the front simultaneously.

Y.Array preserves all concurrent sequence operations and converges, but the
exact resulting ordering may not match either user's local expectation.

Recommended approach:

- use object IDs in `zOrder`;
- remove an object's old ID before reinserting it;
- perform remove and insert in one transaction;
- periodically repair duplicates or dangling IDs;
- avoid rewriting the complete order on every change.

## 10.5 Concurrent point insertion

Two users should normally not edit one freehand stroke after it is completed.

For tools where concurrent sequence editing is valid, `Y.Array` merges inserts
without losing either user's content. The renderer must accept an ordering
produced by the CRDT rather than relying on local insertion timing.

---

## 11. Transaction origins

Origins identify the source of a transaction.

```ts
export const ORIGINS = {
  draw: Symbol("draw"),
  transform: Symbol("transform"),
  style: Symbol("style"),
  text: Symbol("text"),
  delete: Symbol("delete"),
  import: Symbol("import"),
} as const;
```

Use origins for:

- selective undo;
- analytics;
- observer filtering;
- preventing provider echo loops;
- distinguishing imports from user edits.

```ts
doc.transact(() => {
  object.set("fill", "#7c3aed");
}, ORIGINS.style);
```

Origins should be stable object or symbol references. Recreating an origin
object for every operation prevents identity-based tracking.

---

## 12. Undo and redo

Yjs provides `Y.UndoManager`, which can scope undo history to specific shared
types and transaction origins.

```ts
const undoManager = new Y.UndoManager([objects, zOrder], {
  captureTimeout: 400,
  trackedOrigins: new Set([
    ORIGINS.draw,
    ORIGINS.transform,
    ORIGINS.style,
    ORIGINS.text,
    ORIGINS.delete,
  ]),
});
```

### Selective local undo

A collaborative editor should generally undo only the current user's local
operations, not remote collaborators' edits.

Use local origin instances:

```ts
class LocalCanvasOrigin {
  constructor(
    readonly userId: string,
    readonly operation: string,
  ) {}
}

const localTransformOrigin = new LocalCanvasOrigin(currentUserId, "transform");

const undoManager = new Y.UndoManager([objects, zOrder], {
  trackedOrigins: new Set([localTransformOrigin]),
});
```

Reuse the same origin instance for operations that belong to that local undo
scope.

### Grouping drag changes

A drag may emit many updates. Group them into one undo item.

```ts
function beginDrag() {
  undoManager.stopCapturing();
}

function updateDrag(x: number, y: number) {
  doc.transact(() => {
    object.set("x", x);
    object.set("y", y);
  }, localTransformOrigin);
}

function endDrag() {
  undoManager.stopCapturing();
}
```

`captureTimeout` merges nearby operations. `stopCapturing()` forces a boundary.

### Undo UI state

```ts
function updateUndoButtons() {
  setCanUndo(undoManager.canUndo());
  setCanRedo(undoManager.canRedo());
}

undoManager.on("stack-item-added", updateUndoButtons);
undoManager.on("stack-item-popped", updateUndoButtons);
undoManager.on("stack-cleared", updateUndoButtons);
```

Clean up listeners and call:

```ts
undoManager.destroy();
```

when the board is destroyed.

### Undo limitations

Undo may not visually restore an exact historic state if remote collaborators
edited the same objects in the meantime. The operation is transformed against
the current CRDT state so the document remains convergent.

---

## 13. Cursor and presence awareness

Awareness is ephemeral presence data. It is not part of the persistent Yjs
document.

Recommended state:

```ts
type WhiteboardAwarenessState = {
  user: {
    id: string;
    name: string;
    color: string;
    avatarUrl?: string;
  };
  cursor?: {
    x: number;
    y: number;
  };
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  selection?: {
    objectIds: string[];
  };
  tool?: {
    name: string;
  };
  dragging?: {
    objectId: string;
  };
};
```

Set the local user state:

```ts
provider.awareness.setLocalStateField("user", {
  id: user.id,
  name: user.name,
  color: user.color,
  avatarUrl: user.avatarUrl,
});
```

Update the cursor:

```ts
provider.awareness.setLocalStateField("cursor", {
  x: canvasX,
  y: canvasY,
});
```

Read remote states:

```ts
provider.awareness.on("change", () => {
  const remoteUsers = Array.from(provider.awareness.getStates().entries())
    .filter(([clientId]) => clientId !== doc.clientID)
    .map(([clientId, state]) => ({
      clientId,
      ...state,
    }));

  renderRemotePresence(remoteUsers);
});
```

### Awareness rules

- Do not store cursor positions in the persistent `Y.Doc`.
- Throttle pointer updates, for example to 20–30 updates per second.
- Use canvas coordinates, not raw screen coordinates.
- Treat awareness values as untrusted input.
- Limit selection array size.
- Remove or hide stale presence when the provider disconnects.
- Do not expose private email addresses unless product requirements permit it.

Awareness client IDs identify a Yjs session, not a permanent WorkSphere user.
Include the authenticated user ID separately.

---

## 14. Coordinate conversion for remote cursors

Convert browser pointer coordinates into canvas coordinates before broadcasting.

```ts
function screenToCanvas(input: {
  clientX: number;
  clientY: number;
  bounds: DOMRect;
  viewportX: number;
  viewportY: number;
  zoom: number;
}) {
  return {
    x: (input.clientX - input.bounds.left - input.viewportX) / input.zoom,
    y: (input.clientY - input.bounds.top - input.viewportY) / input.zoom,
  };
}
```

Every collaborator can render that point using their own viewport transform.

This is more reliable than broadcasting viewport-relative pixels.

---

## 15. PartyKit room design

Use one PartyKit room per board:

```text
whiteboard:<boardId>
```

The client must not choose an arbitrary board ID without authorization.

Recommended connection flow:

1. Authenticate the WorkSphere user.
2. Confirm the user can access the board.
3. Connect to the PartyKit room.
4. Exchange the Yjs synchronization handshake.
5. Exchange awareness messages.
6. Persist Yjs updates or periodic snapshots.
7. Remove awareness state on disconnect.

Conceptual client:

```ts
const provider = new PartyKitYjsProvider({
  host: process.env.NEXT_PUBLIC_PARTYKIT_HOST!,
  room: `whiteboard:${boardId}`,
  doc,
  params: {
    token: shortLivedBoardToken,
  },
});
```

The exact provider class depends on the project's PartyKit/Yjs binding. The
important requirements are:

- binary update transport;
- initial state synchronization;
- awareness support;
- reconnect behavior;
- server-side authorization;
- persistence.

---

## 16. Yjs synchronization messages

A custom provider typically exchanges:

- sync step 1;
- sync step 2;
- incremental Yjs updates;
- awareness updates.

Do not parse Yjs updates as JSON. They are binary `Uint8Array` values.

Conceptual PartyKit server flow:

```ts
export default class WhiteboardParty {
  constructor(readonly room: Party.Room) {}

  async onConnect(
    connection: Party.Connection,
    context: Party.ConnectionContext,
  ) {
    await authorizeConnection(context.request, this.room.id);

    // Send current document synchronization state.
    sendInitialSync(connection);
    sendCurrentAwareness(connection);
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    if (!(message instanceof ArrayBuffer)) {
      return;
    }

    const update = new Uint8Array(message);

    // Decode message type, apply Yjs update or awareness update,
    // then broadcast the binary message to other authorized peers.
    applyAndBroadcast(update, sender);
  }

  onClose(connection: Party.Connection) {
    removeConnectionAwareness(connection.id);
  }
}
```

Do not blindly broadcast client messages before validating:

- connection authorization;
- message type;
- maximum size;
- room membership;
- rate limits.

---

## 17. Preventing update echo loops

Use transaction origins to distinguish provider-applied changes.

```ts
const PROVIDER_ORIGIN = Symbol("partykit-provider");

doc.on("update", (update, origin) => {
  if (origin === PROVIDER_ORIGIN) {
    return;
  }

  socket.send(update);
});

socket.addEventListener("message", (event) => {
  const update = new Uint8Array(event.data);
  Y.applyUpdate(doc, update, PROVIDER_ORIGIN);
});
```

Yjs updates are idempotent, but filtering echoes avoids unnecessary bandwidth
and event processing.

---

## 18. Offline editing and reconnection

Yjs allows clients to edit while temporarily disconnected.

On reconnection:

1. complete the normal Yjs state-vector synchronization;
2. exchange missing updates;
3. restore local awareness;
4. render the merged document;
5. do not discard local state because the server snapshot is older.

Optional IndexedDB persistence can keep a local board available across reloads:

```ts
const indexeddbProvider = new IndexeddbPersistence(
  `whiteboard:${boardId}`,
  doc,
);

await indexeddbProvider.whenSynced;
```

The network provider and local persistence provider may share the same `Y.Doc`.

Do not use local persistence as the authorization source. Access must still be
checked when reconnecting.

---

## 19. Server persistence

Two common strategies are available.

### 19.1 Store incremental updates

Persist each Yjs binary update with:

- board ID;
- sequence or creation time;
- binary update;
- optional authenticated actor metadata.

Advantages:

- simple append path;
- auditability;
- no complete document rewrite per edit.

Costs:

- update log grows;
- startup requires merging many updates;
- compaction is required.

### 19.2 Store compact snapshots

Periodically persist:

```ts
const snapshot = Y.encodeStateAsUpdate(doc);
```

Advantages:

- faster room startup;
- simple current-state restore.

Costs:

- less detailed history;
- larger write per snapshot;
- snapshot scheduling and consistency required.

### Recommended hybrid

- append updates during collaboration;
- periodically write a compact snapshot;
- delete updates already represented by the snapshot;
- retain an audit history only when required.

Persist updates before or alongside broadcast according to the application's
durability requirements.

---

## 20. Schema versioning

Store a schema version in metadata:

```ts
metadata.set("schemaVersion", 1);
```

On load:

```ts
const version = metadata.get("schemaVersion");

if (version === undefined) {
  migrateLegacyBoard(doc);
}

if (version !== 1) {
  throw new Error("Unsupported whiteboard schema version");
}
```

Migrations should be deterministic Yjs transactions.

Do not reinterpret the same shared field with incompatible meanings across
client versions.

---

## 21. Validation and security

CRDT synchronization does not automatically make application data safe.

Validate:

- authenticated user;
- board membership;
- object type;
- object count;
- coordinate bounds;
- numeric finiteness;
- string lengths;
- image URL schemes;
- update message size;
- update rate;
- awareness state size.

Recommended limits:

| Value                        |                      Example limit |
| ---------------------------- | ---------------------------------: |
| Objects per board            |                             10,000 |
| Text content per object      |                  20,000 characters |
| Awareness selection IDs      |                                100 |
| Display name                 |                      80 characters |
| Individual WebSocket message | 1–5 MB, depending on product needs |
| Cursor update frequency      |                   20–30 per second |

Do not render user-provided HTML directly. Canvas text should be treated as
plain text unless a separately sanitized rich-text pipeline exists.

---

## 22. Handling malformed state

The renderer must fail safely when a remote or old client produces unexpected
data.

```ts
function readFiniteNumber(
  object: Y.Map<unknown>,
  key: string,
  fallback: number,
) {
  const value = Number(object.get(key));
  return Number.isFinite(value) ? value : fallback;
}
```

```ts
const x = readFiniteNumber(object, "x", 0);
const y = readFiniteNumber(object, "y", 0);
const width = Math.max(1, readFiniteNumber(object, "width", 100));
```

Skip unknown object types rather than crashing the entire board.

---

## 23. Garbage collection and deleted content

Yjs garbage collection is enabled by default.

Disabling garbage collection may be useful for advanced history restoration,
but increases memory and persistence size:

```ts
const doc = new Y.Doc({
  gc: false,
});
```

Do not disable GC solely to implement normal undo. `Y.UndoManager` handles
tracked undo operations.

Choose the GC strategy before relying on permanent historic restoration.

---

## 24. Performance guidance

### Client

- batch pointer/stroke updates;
- avoid converting the entire document to JSON on every transaction;
- render only changed objects;
- throttle awareness;
- virtualize off-screen object controls;
- move heavy path simplification to a worker;
- destroy providers, observers, and undo managers on unmount.

### Network

- use binary WebSocket messages;
- avoid echoing provider-origin updates;
- enforce message-size limits;
- compact persisted updates;
- reconnect with backoff and jitter.

### Server

- use one active Y.Doc per busy room when practical;
- evict inactive rooms after persistence;
- avoid unbounded update logs;
- monitor room memory, connection count, update rate, and persistence latency.

---

## 25. Testing conflict resolution

Use multiple independent `Y.Doc` instances.

```ts
function connectDocuments(left: Y.Doc, right: Y.Doc) {
  left.on("update", (update) => {
    Y.applyUpdate(right, update);
  });

  right.on("update", (update) => {
    Y.applyUpdate(left, update);
  });
}
```

### Test different-property merging

```ts
it("merges concurrent property changes", () => {
  const first = new Y.Doc();
  const second = new Y.Doc();

  const seed = new Y.Doc();
  const seedObjects = seed.getMap<Y.Map<unknown>>("objects");
  const object = new Y.Map<unknown>();
  object.set("x", 0);
  object.set("fill", "#fff");
  seedObjects.set("shape-1", object);

  const initial = Y.encodeStateAsUpdate(seed);
  Y.applyUpdate(first, initial);
  Y.applyUpdate(second, initial);

  first.getMap<Y.Map<unknown>>("objects").get("shape-1")?.set("x", 100);

  second.getMap<Y.Map<unknown>>("objects").get("shape-1")?.set("fill", "#000");

  const firstUpdate = Y.encodeStateAsUpdate(first);
  const secondUpdate = Y.encodeStateAsUpdate(second);

  Y.applyUpdate(first, secondUpdate);
  Y.applyUpdate(second, firstUpdate);

  expect(first.getMap<Y.Map<unknown>>("objects").toJSON()).toEqual(
    second.getMap<Y.Map<unknown>>("objects").toJSON(),
  );
});
```

### Required integration tests

- simultaneous object creation;
- concurrent edits to different properties;
- concurrent edits to the same property;
- delete versus update;
- concurrent z-order changes;
- undo after remote edits;
- disconnect, offline edit, and reconnect;
- awareness add/update/remove;
- unauthorized PartyKit connection;
- malformed or oversized message rejection;
- server restart and state restoration.

The core assertion is convergence:

```ts
expect(Y.encodeStateAsUpdate(docA)).toEqual(Y.encodeStateAsUpdate(docB));
```

For binary equality, documents may have equivalent state even if raw update
encoding differs. A safer comparison is to exchange final state updates and
compare normalized shared-type JSON.

---

## 26. Cleanup lifecycle

When leaving a board:

```ts
rendererCleanup();
undoManager.destroy();
provider.destroy();
indexeddbProvider.destroy();
doc.destroy();
```

Also clear local awareness before disconnecting when supported:

```ts
provider.awareness.setLocalState(null);
```

Failing to remove observers and providers can create duplicate network
connections and duplicate updates during React hot reload or route changes.

---

## 27. Pull-request review checklist

### Data model

- [ ] Stable top-level shared-type names are used.
- [ ] Objects use stable IDs.
- [ ] Mutable properties use nested shared types.
- [ ] Z-order is separate from object records.
- [ ] Text uses `Y.Text` when concurrent character editing is required.
- [ ] Large point arrays are batched or compacted.

### Transactions and conflicts

- [ ] Multi-field operations use `doc.transact`.
- [ ] Transaction origins are stable and documented.
- [ ] Delete operations clean related indexes/order entries.
- [ ] Rendering tolerates missing and malformed objects.
- [ ] Conflict tests demonstrate convergence.

### Undo and redo

- [ ] Undo is scoped to appropriate shared types.
- [ ] Remote operations are not unintentionally included.
- [ ] Drag/stroke operations have clear capture boundaries.
- [ ] UndoManager is destroyed during cleanup.

### Awareness

- [ ] Cursor data uses canvas coordinates.
- [ ] Awareness updates are throttled.
- [ ] Presence data is not persisted as board content.
- [ ] Stale states are removed on disconnect.
- [ ] Awareness payloads are validated.

### PartyKit synchronization

- [ ] Room access is authenticated and authorized.
- [ ] Binary Yjs messages are supported.
- [ ] Provider-origin updates are not echoed unnecessarily.
- [ ] Reconnection merges state rather than replacing it.
- [ ] Updates or snapshots are durably persisted.
- [ ] Message size and rate limits exist.

---

## 28. Summary

The recommended WorkSphere whiteboard model is:

```text
Y.Doc
├── objects: Y.Map<objectId, Y.Map>
├── zOrder: Y.Array<objectId>
├── pages: Y.Array<Y.Map>
└── metadata: Y.Map
```

Use:

- `Y.Map` for independently editable object fields;
- `Y.Array` for ordered IDs and point sequences;
- `Y.Text` for collaboratively editable text;
- `doc.transact()` for atomic multi-field operations;
- `Y.UndoManager` with tracked local origins;
- awareness for cursors, selections, tools, and presence;
- PartyKit for authorized WebSocket fan-out and persistence;
- reconnection through Yjs state synchronization;
- explicit validation, limits, cleanup, and convergence tests.
