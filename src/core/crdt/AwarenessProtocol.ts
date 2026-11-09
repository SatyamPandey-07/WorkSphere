/**
 * AwarenessProtocol.ts
 * Wraps y-protocols/awareness for synchronizing ephemeral collaborative states
 * (username, avatar, active deskId, focus timer state, mouse/touch coordinates)
 * across distributed clients over PartyKit WebSockets.
 */

import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";

export interface FocusTimerState {
  isActive: boolean;
  durationMinutes: number;
  remainingSeconds: number;
  sessionType: "pomodoro" | "deepwork" | "break";
}

export interface Coordinates {
  x: number;
  y: number;
}

export interface PeerPresenceState {
  username: string;
  avatar: string | null;
  deskId?: string | null;
  focusTimer?: FocusTimerState | null;
  cursor?: Coordinates | null;
  status: "active" | "idle" | "focusing";
  lastActiveAt: number;
}

export type AwarenessChangeHandler = (
  peers: Map<number, PeerPresenceState>,
  origin: unknown
) => void;

export class AwarenessProtocol {
  private doc: Y.Doc;
  private awareness: Awareness;
  private changeHandlers: Set<AwarenessChangeHandler> = new Set();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly INACTIVE_TIMEOUT_MS = 15_000;
  private static readonly HEARTBEAT_INTERVAL_MS = 5_000;

  constructor(doc?: Y.Doc, awarenessInstance?: Awareness) {
    this.doc = doc || new Y.Doc();
    this.awareness = awarenessInstance || new Awareness(this.doc);

    this.awareness.on("change", (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const activePeers = this.getActivePeers();
      this.changeHandlers.forEach((handler) => handler(activePeers, origin));
    });

    this.startHeartbeatSweep();
  }

  public getAwareness(): Awareness {
    return this.awareness;
  }

  public getClientID(): number {
    return this.doc.clientID;
  }

  public setLocalState(state: Partial<PeerPresenceState>): void {
    const currentState = (this.awareness.getLocalState() as PeerPresenceState | null) || {
      username: "Guest",
      avatar: null,
      status: "active",
      lastActiveAt: Date.now(),
    };

    const updatedState: PeerPresenceState = {
      ...currentState,
      ...state,
      lastActiveAt: Date.now(),
    };

    this.awareness.setLocalState(updatedState);
  }

  public getLocalState(): PeerPresenceState | null {
    return (this.awareness.getLocalState() as PeerPresenceState | null) || null;
  }

  public updateCursor(coordinates: Coordinates | null): void {
    const local = this.getLocalState();
    if (!local) return;
    this.setLocalState({ cursor: coordinates });
  }

  public updateDesk(deskId: string | null): void {
    this.setLocalState({ deskId });
  }

  public updateFocusTimer(timer: FocusTimerState | null): void {
    this.setLocalState({
      focusTimer: timer,
      status: timer?.isActive ? "focusing" : "active",
    });
  }

  public encodeUpdate(clients?: number[]): Uint8Array {
    return encodeAwarenessUpdate(
      this.awareness,
      clients || Array.from(this.awareness.getStates().keys())
    );
  }

  public applyUpdate(update: Uint8Array, origin?: unknown): void {
    applyAwarenessUpdate(this.awareness, update, origin);
  }

  public getActivePeers(): Map<number, PeerPresenceState> {
    const now = Date.now();
    const result = new Map<number, PeerPresenceState>();

    this.awareness.getStates().forEach((state, clientID) => {
      if (!state) return;
      const peerState = state as PeerPresenceState;
      if (
        peerState.lastActiveAt &&
        now - peerState.lastActiveAt > AwarenessProtocol.INACTIVE_TIMEOUT_MS
      ) {
        // Prune stale peer
        return;
      }
      result.set(clientID, peerState);
    });

    return result;
  }

  public onChange(handler: AwarenessChangeHandler): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  public startHeartbeatSweep(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const local = this.getLocalState();
      if (local) {
        // Ping our own heartbeat timestamp to keep presence fresh
        this.awareness.setLocalState({
          ...local,
          lastActiveAt: now,
        });
      }

      // Check and remove any peer whose heartbeat exceeded 15s
      const staleClients: number[] = [];
      this.awareness.getStates().forEach((state, clientID) => {
        if (clientID === this.getClientID()) return;
        const peer = state as PeerPresenceState | null;
        if (
          !peer ||
          !peer.lastActiveAt ||
          now - peer.lastActiveAt > AwarenessProtocol.INACTIVE_TIMEOUT_MS
        ) {
          staleClients.push(clientID);
        }
      });

      if (staleClients.length > 0) {
        removeAwarenessStates(this.awareness, staleClients, "timeout");
      }
    }, AwarenessProtocol.HEARTBEAT_INTERVAL_MS);
  }

  public destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.changeHandlers.clear();
    removeAwarenessStates(this.awareness, [this.getClientID()], "disconnect");
    this.awareness.destroy();
  }
}
