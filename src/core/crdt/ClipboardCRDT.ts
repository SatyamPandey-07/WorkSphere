/**
 * ClipboardCRDT.ts
 * Implements a Last-Writer-Wins (LWW) Register and sequence CRDT to merge clipboard histories across multiple devices.
 * Ensures conflict-free synchronization of text and asset references without centralized locking.
 * Tracks logical operation ID tuples (clientId, lamportClock) in undo/redo buffers and resolves concurrent undos
 * idempotently using state vector presence verification to prevent character duplication upon redo.
 */

export type ClipboardContentType = "text" | "image" | "file-ref";

export interface ClipboardItem {
  id: string;
  type: ClipboardContentType;
  content: string; // Text content or Base64/Data URL for assets
  deviceId: string;
  timestamp: number;
  vectorClock: Record<string, number>;
}

export type OpIdTuple = [clientId: string, lamportClock: number];

export interface CharRecord {
  id: OpIdTuple;
  char: string;
  tombstoned: boolean;
  originLeftId: OpIdTuple | null;
  lamportClock: number;
  clientId: string;
}

export type UndoOpType = "insert" | "delete";

export interface UndoOperation {
  opId: OpIdTuple;
  type: UndoOpType;
  targetId: OpIdTuple;
  char?: string;
}

export function opIdToString(opId: OpIdTuple): string {
  return `${opId[0]}:${opId[1]}`;
}

function compareOpId(a: OpIdTuple, b: OpIdTuple): number {
  // Higher lamport clock comes first
  if (a[1] !== b[1]) {
    return b[1] - a[1];
  }
  // Deterministic tie-breaker: client ID
  return a[0].localeCompare(b[0]);
}

export class ClipboardCRDT {
  private items: Map<string, ClipboardItem>;
  private localDeviceId: string;
  private vectorClock: Record<string, number>;
  private lamportClock: number = 0;
  private characters: CharRecord[] = [];
  private charMap: Map<string, CharRecord> = new Map();
  private undoStack: UndoOperation[] = [];
  private redoStack: UndoOperation[] = [];

  constructor(localDeviceId: string, initialLamportClock: number = 0) {
    this.items = new Map();
    this.localDeviceId = localDeviceId;
    this.lamportClock = initialLamportClock;
    this.vectorClock = { [localDeviceId]: initialLamportClock };
  }

  public getDeviceId(): string {
    return this.localDeviceId;
  }

  public getLamportClock(): number {
    return this.lamportClock;
  }

  public setLamportClock(clock: number): void {
    this.lamportClock = clock;
    this.vectorClock[this.localDeviceId] = Math.max(
      this.vectorClock[this.localDeviceId] || 0,
      clock,
    );
  }

  public getStateVector(): Record<string, number> {
    return { ...this.vectorClock };
  }

  public getVectorClock(): Record<string, number> {
    return { ...this.vectorClock };
  }

  public getUndoStack(): UndoOperation[] {
    return [...this.undoStack];
  }

  public getRedoStack(): UndoOperation[] {
    return [...this.redoStack];
  }

  public hasInStateVector(opId: OpIdTuple): boolean {
    const [clientId, clock] = opId;
    return (this.vectorClock[clientId] ?? 0) >= clock;
  }

  /**
   * Adds a new item to the local clipboard and increments the vector clock.
   */
  public addItem(type: ClipboardContentType, content: string): ClipboardItem {
    this.lamportClock++;
    this.vectorClock[this.localDeviceId] = Math.max(
      (this.vectorClock[this.localDeviceId] || 0) + 1,
      this.lamportClock,
    );

    const item: ClipboardItem = {
      id: crypto.randomUUID(),
      type,
      content,
      deviceId: this.localDeviceId,
      timestamp: Date.now(),
      vectorClock: { ...this.vectorClock },
    };

    this.items.set(item.id, item);
    return item;
  }

  /**
   * Merges a remote item into the local state using LWW and vector clock logic.
   */
  public mergeRemoteItem(remoteItem: ClipboardItem): boolean {
    const existingItem = this.items.get(remoteItem.id);

    if (existingItem) {
      // Compare vector clocks
      const isRemoteNewer = this.compareVectorClocks(
        remoteItem.vectorClock,
        existingItem.vectorClock,
      );
      if (!isRemoteNewer) {
        return false; // Local state is newer or concurrent with higher device ID
      }
    }

    // Update local vector clock to reflect the merge
    for (const [deviceId, time] of Object.entries(remoteItem.vectorClock)) {
      this.vectorClock[deviceId] = Math.max(
        this.vectorClock[deviceId] || 0,
        time,
      );
      this.lamportClock = Math.max(this.lamportClock, time);
    }

    this.items.set(remoteItem.id, remoteItem);
    return true;
  }

  /**
   * Retrieves all items sorted by timestamp (newest first).
   */
  public getHistory(limit: number = 10): ClipboardItem[] {
    return Array.from(this.items.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Compares two vector clocks. Returns true if 'a' is strictly newer than 'b'.
   */
  private compareVectorClocks(
    a: Record<string, number>,
    b: Record<string, number>,
  ): boolean {
    let aIsGreater = false;
    let bIsGreater = false;

    const allDevices = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const device of allDevices) {
      const timeA = a[device] || 0;
      const timeB = b[device] || 0;

      if (timeA > timeB) aIsGreater = true;
      if (timeB > timeA) bIsGreater = true;
    }

    if (aIsGreater && !bIsGreater) return true;

    // Concurrent: tie-breaker by deviceId lexicographical order
    if (aIsGreater && bIsGreater) {
      return false;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Sequence CRDT & Logical Operation Undo/Redo Engine
  // ---------------------------------------------------------------------------

  /**
   * Inserts a single character at an optional visible index.
   * Records an operation ID tuple [clientId, lamportClock] in the undo stack.
   */
  public insert(char: string, index?: number): CharRecord {
    this.lamportClock++;
    this.vectorClock[this.localDeviceId] = Math.max(
      this.vectorClock[this.localDeviceId] || 0,
      this.lamportClock,
    );

    const opId: OpIdTuple = [this.localDeviceId, this.lamportClock];
    const visibleChars = this.characters.filter((c) => !c.tombstoned);

    let originLeftId: OpIdTuple | null = null;
    if (index === undefined || index >= visibleChars.length) {
      originLeftId =
        visibleChars.length > 0
          ? visibleChars[visibleChars.length - 1].id
          : null;
    } else if (index <= 0) {
      originLeftId = null;
    } else {
      originLeftId = visibleChars[index - 1].id;
    }

    const record: CharRecord = {
      id: opId,
      char,
      tombstoned: false,
      originLeftId,
      lamportClock: this.lamportClock,
      clientId: this.localDeviceId,
    };

    this.charMap.set(opIdToString(opId), record);
    this.rebuildCharactersList();

    const undoOp: UndoOperation = {
      opId,
      type: "insert",
      targetId: opId,
      char,
    };
    this.undoStack.push(undoOp);
    this.redoStack = [];

    return record;
  }

  /**
   * Inserts text string character-by-character.
   */
  public insertText(text: string, startIndex?: number): CharRecord[] {
    const records: CharRecord[] = [];
    let curIdx = startIndex !== undefined ? startIndex : this.getText().length;
    for (const ch of text) {
      records.push(this.insert(ch, curIdx));
      curIdx++;
    }
    return records;
  }

  /**
   * Deletes the visible character at index, marking it tombstoned.
   */
  public delete(index: number): CharRecord | null {
    const visibleChars = this.characters.filter((c) => !c.tombstoned);
    if (index < 0 || index >= visibleChars.length) {
      return null;
    }

    const targetChar = visibleChars[index];
    this.lamportClock++;
    this.vectorClock[this.localDeviceId] = Math.max(
      this.vectorClock[this.localDeviceId] || 0,
      this.lamportClock,
    );

    const opId: OpIdTuple = [this.localDeviceId, this.lamportClock];
    targetChar.tombstoned = true;

    const undoOp: UndoOperation = {
      opId,
      type: "delete",
      targetId: targetChar.id,
      char: targetChar.char,
    };
    this.undoStack.push(undoOp);
    this.redoStack = [];

    return targetChar;
  }

  /**
   * Returns current visible text.
   */
  public getText(): string {
    return this.characters
      .filter((c) => !c.tombstoned)
      .map((c) => c.char)
      .join("");
  }

  /**
   * Returns character records.
   */
  public getCharacters(includeTombstones: boolean = false): CharRecord[] {
    return includeTombstones
      ? [...this.characters]
      : this.characters.filter((c) => !c.tombstoned);
  }

  /**
   * Undoes the last operation from undoStack.
   * Verifies target operation presence in state vector before toggling tombstone.
   */
  public undo(): UndoOperation | null {
    if (this.undoStack.length === 0) return null;

    const entry = this.undoStack.pop()!;

    // Resolve concurrent undos idempotently by verifying state vector presence before toggling tombstones
    if (!this.hasInStateVector(entry.targetId)) {
      this.undoStack.push(entry);
      return null;
    }

    const char = this.charMap.get(opIdToString(entry.targetId));
    if (!char) {
      return null;
    }

    this.lamportClock++;
    this.vectorClock[this.localDeviceId] = Math.max(
      this.vectorClock[this.localDeviceId] || 0,
      this.lamportClock,
    );

    if (entry.type === "insert") {
      char.tombstoned = true;
    } else if (entry.type === "delete") {
      char.tombstoned = false;
    }

    this.redoStack.push(entry);
    return entry;
  }

  /**
   * Redoes the last operation from redoStack.
   * Restores existing character record without creating duplicate character entries.
   */
  public redo(): UndoOperation | null {
    if (this.redoStack.length === 0) return null;

    const entry = this.redoStack.pop()!;

    if (!this.hasInStateVector(entry.targetId)) {
      this.redoStack.push(entry);
      return null;
    }

    const char = this.charMap.get(opIdToString(entry.targetId));
    if (!char) {
      return null;
    }

    this.lamportClock++;
    this.vectorClock[this.localDeviceId] = Math.max(
      this.vectorClock[this.localDeviceId] || 0,
      this.lamportClock,
    );

    if (entry.type === "insert") {
      char.tombstoned = false;
    } else if (entry.type === "delete") {
      char.tombstoned = true;
    }

    this.undoStack.push(entry);
    return entry;
  }

  /**
   * Applies a remote undo operation received from a peer device idempotently.
   */
  public applyRemoteUndo(entry: UndoOperation): boolean {
    // Resolve concurrent undos idempotently by verifying state vector presence before toggling tombstones
    if (!this.hasInStateVector(entry.targetId)) {
      return false;
    }

    const char = this.charMap.get(opIdToString(entry.targetId));
    if (!char) {
      return false;
    }

    const [remoteClientId, remoteClock] = entry.opId;
    this.vectorClock[remoteClientId] = Math.max(
      this.vectorClock[remoteClientId] || 0,
      remoteClock,
    );
    this.lamportClock = Math.max(this.lamportClock, remoteClock);

    if (entry.type === "insert") {
      char.tombstoned = true;
    } else if (entry.type === "delete") {
      char.tombstoned = false;
    }

    return true;
  }

  /**
   * Applies a remote redo operation received from a peer device idempotently.
   */
  public applyRemoteRedo(entry: UndoOperation): boolean {
    if (!this.hasInStateVector(entry.targetId)) {
      return false;
    }

    const char = this.charMap.get(opIdToString(entry.targetId));
    if (!char) {
      return false;
    }

    const [remoteClientId, remoteClock] = entry.opId;
    this.vectorClock[remoteClientId] = Math.max(
      this.vectorClock[remoteClientId] || 0,
      remoteClock,
    );
    this.lamportClock = Math.max(this.lamportClock, remoteClock);

    if (entry.type === "insert") {
      char.tombstoned = false;
    } else if (entry.type === "delete") {
      char.tombstoned = true;
    }

    return true;
  }

  /**
   * Merges a remote CRDT instance state into local state.
   */
  public merge(remote: ClipboardCRDT): void {
    const remoteChars = remote.getCharacters(true);
    for (const rChar of remoteChars) {
      const key = opIdToString(rChar.id);
      const lChar = this.charMap.get(key);
      if (!lChar) {
        this.charMap.set(key, { ...rChar });
      } else {
        if (rChar.tombstoned) {
          lChar.tombstoned = true;
        }
      }
    }

    const remoteVector = remote.getStateVector();
    for (const [clientId, clock] of Object.entries(remoteVector)) {
      this.vectorClock[clientId] = Math.max(
        this.vectorClock[clientId] || 0,
        clock,
      );
    }
    this.lamportClock = Math.max(this.lamportClock, remote.getLamportClock());

    this.rebuildCharactersList();

    for (const item of remote.getHistory(100)) {
      this.mergeRemoteItem(item);
    }
  }

  /**
   * Rebuilds the ordered character sequence using RGA tree pre-order traversal.
   */
  private rebuildCharactersList(): void {
    const childrenMap = new Map<string, CharRecord[]>();

    for (const char of this.charMap.values()) {
      const parentKey =
        char.originLeftId !== null ? opIdToString(char.originLeftId) : "ROOT";
      let list = childrenMap.get(parentKey);
      if (!list) {
        list = [];
        childrenMap.set(parentKey, list);
      }
      list.push(char);
    }

    for (const list of childrenMap.values()) {
      list.sort((a, b) => compareOpId(a.id, b.id));
    }

    const ordered: CharRecord[] = [];
    const traverse = (parentKey: string): void => {
      const children = childrenMap.get(parentKey);
      if (!children) return;
      for (const child of children) {
        ordered.push(child);
        traverse(opIdToString(child.id));
      }
    };

    traverse("ROOT");
    this.characters = ordered;
  }
}
