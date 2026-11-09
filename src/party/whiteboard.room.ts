/**
 * whiteboard.room.ts
 * PartyKit room configuration to manage WebSocket connections and broadcast CRDT deltas.
 * Implements monotonic sequence numbering and client-side stroke reconciliation
 * to guarantee in-order canvas replay upon WebSocket reconnection (#5360).
 */

import type * as Party from "partykit/server";
import { CrdtDocument, CrdtOperation } from "@/core/crdt/CrdtDocument";

export interface SequencedOperation extends CrdtOperation {
  sequenceNumber?: number;
  clientSeq?: number;
}

export interface OperationLogEntry {
  sequenceNumber: number;
  operation: SequencedOperation;
  timestamp: number;
}

interface NoteLease {
  ownerId: string;
  ownerUserId: string;
  expiresAt: number;
  timeout: ReturnType<typeof setTimeout>;
}

export const NOTE_LEASE_TIMEOUT_MS = 5000;

export default class WhiteboardRoom implements Party.Server {
  private document: CrdtDocument;
  private roomId: string;
  private sequenceNumber: number = 0;
  private operationLog: OperationLogEntry[] = [];
  private readonly MAX_LOG_SIZE = 1000;

  // Track expected client sequence numbers to buffer and reconcile out-of-order buffered strokes
  private clientSequences: Map<string, number> = new Map();
  private clientPendingBuffers: Map<string, SequencedOperation[]> = new Map();
  private noteLeases: Map<string, NoteLease> = new Map();

  constructor(readonly room: Party.Room) {
    this.roomId = room.id;
    // Initialize with a deterministic nodeId based on room ID for server-side ops
    this.document = new CrdtDocument(`server-${this.roomId}`);
  }

  async onConnect(conn: Party.Connection, _ctx: Party.ConnectionContext) {
    // Send current state along with latest monotonic sequenceNumber to the newly connected client
    conn.send(
      JSON.stringify({
        type: "INIT_STATE",
        payload: this.document.getState(),
        sequenceNumber: this.sequenceNumber,
      }),
    );
    for (const [noteId, lease] of this.noteLeases) {
      if (lease.expiresAt > Date.now()) {
        conn.send(
          JSON.stringify({
            type: "NOTE_LOCK_STATE",
            payload: {
              noteId,
              ownerUserId: lease.ownerUserId,
              expiresAt: lease.expiresAt,
            },
          }),
        );
      }
    }
  }

  private getActiveNoteLease(noteId: string): NoteLease | undefined {
    const lease = this.noteLeases.get(noteId);
    if (!lease) return undefined;
    if (lease.expiresAt > Date.now()) return lease;
    clearTimeout(lease.timeout);
    this.noteLeases.delete(noteId);
    this.broadcastNoteLease(noteId, null);
    return undefined;
  }

  private broadcastNoteLease(noteId: string, lease: NoteLease | null) {
    this.room.broadcast(
      JSON.stringify({
        type: "NOTE_LOCK_STATE",
        payload: {
          noteId,
          ownerUserId: lease?.ownerUserId ?? null,
          expiresAt: lease?.expiresAt ?? null,
        },
      }),
    );
  }

  private releaseNoteLease(noteId: string, ownerId: string) {
    const lease = this.noteLeases.get(noteId);
    if (!lease || lease.ownerId !== ownerId) return false;
    clearTimeout(lease.timeout);
    this.noteLeases.delete(noteId);
    this.broadcastNoteLease(noteId, null);
    return true;
  }

  private handleHoldNote(
    payload: { noteId?: unknown; userId?: unknown; requestId?: unknown },
    sender: Party.Connection,
  ) {
    const noteId = payload.noteId;
    const requestId = payload.requestId;
    if (typeof noteId !== "string" || noteId.length === 0) return;

    const currentLease = this.getActiveNoteLease(noteId);
    if (currentLease && currentLease.ownerId !== sender.id) {
      sender.send(
        JSON.stringify({
          type: "NOTE_LOCK_DENIED",
          payload: { noteId, requestId },
        }),
      );
      return;
    }

    if (currentLease) clearTimeout(currentLease.timeout);
    const lease: NoteLease = {
      ownerId: sender.id,
      ownerUserId:
        (sender.state as { userId?: string } | null)?.userId ??
        (typeof payload.userId === "string" ? payload.userId : sender.id),
      expiresAt: Date.now() + NOTE_LEASE_TIMEOUT_MS,
      timeout: setTimeout(() => {
        if (this.noteLeases.get(noteId) !== lease) return;
        this.noteLeases.delete(noteId);
        this.broadcastNoteLease(noteId, null);
      }, NOTE_LEASE_TIMEOUT_MS),
    };
    this.noteLeases.set(noteId, lease);

    sender.send(
      JSON.stringify({
        type: "NOTE_LOCK_GRANTED",
        payload: { noteId, requestId, expiresAt: lease.expiresAt },
      }),
    );
    this.broadcastNoteLease(noteId, lease);
  }

  private isOperationBlockedByNoteLease(
    op: SequencedOperation,
    sender: Party.Connection,
  ): boolean {
    const noteId =
      typeof op.payload?.noteId === "string" ? op.payload.noteId : op.id;
    const lease = this.getActiveNoteLease(noteId);
    if (!lease || lease.ownerId === sender.id) return false;

    sender.send(
      JSON.stringify({
        type: "OPERATION_REJECTED",
        id: op.id,
        reason: "NOTE_LOCKED",
        noteId,
      }),
    );
    return true;
  }

  private applyAndBroadcast(
    op: SequencedOperation,
    sender: Party.Connection,
  ): boolean {
    if (this.isOperationBlockedByNoteLease(op, sender)) return false;
    this.sequenceNumber += 1;
    const stampedOp: SequencedOperation = {
      ...op,
      sequenceNumber: this.sequenceNumber,
    };

    const merged = this.document.mergeRemoteOperation(stampedOp);
    if (merged) {
      this.operationLog.push({
        sequenceNumber: this.sequenceNumber,
        operation: stampedOp,
        timestamp: Date.now(),
      });

      if (this.operationLog.length > this.MAX_LOG_SIZE) {
        this.operationLog.shift();
      }

      // Broadcast to all other connections in strict monotonic sequence order
      this.room.broadcast(
        JSON.stringify({
          type: "OPERATION_APPLIED",
          payload: stampedOp,
          sequenceNumber: this.sequenceNumber,
        }),
        [sender.id],
      );

      // Send sequence acknowledgement back to sender for client-side reconciliation
      sender.send(
        JSON.stringify({
          type: "OPERATION_ACK",
          id: stampedOp.id,
          sequenceNumber: this.sequenceNumber,
          clientSeq: stampedOp.clientSeq,
        }),
      );

      return true;
    }

    return false;
  }

  private processClientOperation(
    op: SequencedOperation,
    sender: Party.Connection,
  ) {
    const clientKey = op.nodeId || sender.id;
    const incomingSeq = op.clientSeq;

    if (typeof incomingSeq === "number") {
      const expectedSeq = (this.clientSequences.get(clientKey) ?? 0) + 1;

      if (incomingSeq === expectedSeq) {
        // In order: apply immediately
        this.applyAndBroadcast(op, sender);
        this.clientSequences.set(clientKey, incomingSeq);

        // Drain any contiguous buffered operations that were waiting
        this.drainPendingBuffer(clientKey, sender);
      } else if (incomingSeq > expectedSeq) {
        // Out-of-order stroke segment arriving early: buffer it
        const buffer = this.clientPendingBuffers.get(clientKey) || [];
        buffer.push(op);
        buffer.sort((a, b) => (a.clientSeq ?? 0) - (b.clientSeq ?? 0));
        this.clientPendingBuffers.set(clientKey, buffer);
      } else {
        // Duplicate or stale sequence: already processed, acknowledge without re-applying
        sender.send(
          JSON.stringify({
            type: "OPERATION_ACK",
            id: op.id,
            sequenceNumber: this.sequenceNumber,
            clientSeq: incomingSeq,
            stale: true,
          }),
        );
      }
    } else {
      // Operation without explicit clientSeq: apply monotonically
      this.applyAndBroadcast(op, sender);
    }
  }

  private drainPendingBuffer(clientKey: string, sender: Party.Connection) {
    const buffer = this.clientPendingBuffers.get(clientKey);
    if (!buffer || buffer.length === 0) return;

    let currentExpected = (this.clientSequences.get(clientKey) ?? 0) + 1;
    while (
      buffer.length > 0 &&
      (buffer[0].clientSeq === currentExpected ||
        buffer[0].clientSeq === undefined)
    ) {
      const nextOp = buffer.shift()!;
      this.applyAndBroadcast(nextOp, sender);
      if (typeof nextOp.clientSeq === "number") {
        currentExpected = nextOp.clientSeq + 1;
        this.clientSequences.set(clientKey, nextOp.clientSeq);
      }
    }

    if (buffer.length === 0) {
      this.clientPendingBuffers.delete(clientKey);
    }
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const parsed = JSON.parse(message);

      if (parsed.type === "HOLD_NOTE") {
        this.handleHoldNote(parsed.payload ?? {}, sender);
      } else if (parsed.type === "RELEASE_NOTE") {
        const noteId = parsed.payload?.noteId;
        if (typeof noteId === "string")
          this.releaseNoteLease(noteId, sender.id);
      } else if (parsed.type === "APPLY_OPERATION") {
        const op = parsed.payload as SequencedOperation;
        this.processClientOperation(op, sender);
      } else if (
        parsed.type === "APPLY_BATCH" ||
        parsed.type === "BATCH_OPERATIONS"
      ) {
        // Client reconnected and sent buffered strokes in batch
        const rawOps = (parsed.payload?.operations ||
          parsed.payload ||
          []) as SequencedOperation[];
        // Monotonically sort buffered strokes by clientSeq or timestamp before applying
        const sortedOps = [...rawOps].sort((a, b) => {
          const seqA = a.clientSeq ?? a.sequenceNumber ?? 0;
          const seqB = b.clientSeq ?? b.sequenceNumber ?? 0;
          if (seqA !== seqB) return seqA - seqB;
          return a.timestamp - b.timestamp;
        });

        const appliedOps: SequencedOperation[] = [];
        for (const op of sortedOps) {
          if (this.isOperationBlockedByNoteLease(op, sender)) continue;
          this.sequenceNumber += 1;
          const stampedOp: SequencedOperation = {
            ...op,
            sequenceNumber: this.sequenceNumber,
          };
          const merged = this.document.mergeRemoteOperation(stampedOp);
          if (merged) {
            this.operationLog.push({
              sequenceNumber: this.sequenceNumber,
              operation: stampedOp,
              timestamp: Date.now(),
            });
            appliedOps.push(stampedOp);
          }
        }

        if (appliedOps.length > 0) {
          this.room.broadcast(
            JSON.stringify({
              type: "BATCH_OPERATIONS_APPLIED",
              payload: { operations: appliedOps },
              sequenceNumber: this.sequenceNumber,
            }),
            [sender.id],
          );

          sender.send(
            JSON.stringify({
              type: "BATCH_ACK",
              sequenceNumber: this.sequenceNumber,
              appliedCount: appliedOps.length,
            }),
          );
        }
      } else if (
        parsed.type === "REQUEST_STATE" ||
        parsed.type === "SYNC_REQUEST"
      ) {
        const lastSeq =
          parsed.payload?.lastSeq ??
          parsed.payload?.lastSequenceNumber ??
          parsed.lastSeq ??
          parsed.lastSequenceNumber;

        // If client provides a valid last sequence number, attempt ordered replay
        if (
          typeof lastSeq === "number" &&
          lastSeq >= 0 &&
          lastSeq < this.sequenceNumber
        ) {
          const earliestLogSeq = this.operationLog[0]?.sequenceNumber ?? 1;

          if (lastSeq >= earliestLogSeq - 1) {
            const missedOps = this.operationLog
              .filter((entry) => entry.sequenceNumber > lastSeq)
              .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
              .map((entry) => entry.operation);

            sender.send(
              JSON.stringify({
                type: "SYNC_REPLAY",
                payload: {
                  fromSeq: lastSeq + 1,
                  toSeq: this.sequenceNumber,
                  operations: missedOps,
                },
                sequenceNumber: this.sequenceNumber,
              }),
            );
            return;
          }
        }

        // Fallback to full initial state
        sender.send(
          JSON.stringify({
            type: "INIT_STATE",
            payload: this.document.getState(),
            sequenceNumber: this.sequenceNumber,
          }),
        );
      } else if (
        parsed.type === "CLEAR_CANVAS" ||
        parsed.type === "CLEAR_BOARD"
      ) {
        this.sequenceNumber += 1;
        this.document = new CrdtDocument(`server-${this.roomId}`);
        this.operationLog = [];
        this.clientSequences.clear();
        this.clientPendingBuffers.clear();

        this.room.broadcast(
          JSON.stringify({
            type: "CANVAS_CLEARED",
            activeTool: "pen",
            sequenceNumber: this.sequenceNumber,
          }),
        );
      }
    } catch (error) {
      console.error("Error processing whiteboard message:", error);
    }
  }

  async onClose(conn: Party.Connection) {
    for (const [noteId, lease] of this.noteLeases) {
      if (lease.ownerId === conn.id) this.releaseNoteLease(noteId, conn.id);
    }
    this.clientSequences.delete(conn.id);
    this.clientPendingBuffers.delete(conn.id);
  }

  async onSave(): Promise<unknown> {
    // Persist the current state to storage with monotonic sequenceNumber
    return {
      roomId: this.roomId,
      state: this.document.getState(),
      sequenceNumber: this.sequenceNumber,
      timestamp: Date.now(),
    };
  }

  async onBeforeConnect(req: Party.Request) {
    // Optional: Authenticate user via Clerk token in headers
    return req;
  }
}
