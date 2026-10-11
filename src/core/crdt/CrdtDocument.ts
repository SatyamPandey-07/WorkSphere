/**
 * CrdtDocument.ts
 * The core CRDT state tree implementation supporting text and drawing operations.
 * Uses a Last-Writer-Wins (LWW) Register strategy combined with Vector Clocks for conflict resolution.
 * Supports distributed selective undo/redo history stacks with causal vector clock preservation (#5310).
 */

import { CrdtVectorClock, VectorClock } from './CrdtVectorClock';

export type OperationType = 'DRAW_STROKE' | 'ADD_TEXT' | 'UPDATE_TEXT' | 'DELETE_ELEMENT';

export interface CrdtOperation {
    id: string;
    type: OperationType;
    nodeId: string;
    timestamp: number;
    vectorClock: VectorClock;
    payload: Record<string, unknown>;
}

export interface CrdtState {
    elements: Record<string, CrdtOperation>;
    vectorClock: VectorClock;
}

export interface HistoryEntry {
    targetId: string;
    appliedOp: CrdtOperation;
    previousOp: CrdtOperation | null;
}

export class CrdtDocument {
    private state: CrdtState;
    private nodeId: string;
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];
    private maxHistorySize: number;

    constructor(
        nodeId: string,
        initialState: CrdtState = { elements: {}, vectorClock: {} },
        maxHistorySize: number = 100
    ) {
        this.nodeId = nodeId;
        this.state = {
            elements: { ...initialState.elements },
            vectorClock: { ...initialState.vectorClock }
        };
        this.maxHistorySize = maxHistorySize;
    }

    private applyInternal(op: Omit<CrdtOperation, 'vectorClock'>): CrdtOperation {
        const vectorClock = new CrdtVectorClock(this.state.vectorClock);
        vectorClock.increment(this.nodeId);

        const fullOp: CrdtOperation = {
            ...op,
            vectorClock: vectorClock.getClock()
        };

        this.state.elements[op.id] = fullOp;
        this.state.vectorClock = vectorClock.getClock();

        return fullOp;
    }

    public applyLocalOperation(op: Omit<CrdtOperation, 'vectorClock'>): CrdtOperation {
        const previousOp = this.state.elements[op.id] ? { ...this.state.elements[op.id] } : null;
        const fullOp = this.applyInternal(op);

        // ponytail: push to local undo stack and clear redo on fresh local edit
        this.undoStack.push({
            targetId: op.id,
            appliedOp: fullOp,
            previousOp
        });
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }
        this.redoStack = [];

        return fullOp;
    }

    public undo(): CrdtOperation | null {
        const entry = this.undoStack.pop();
        if (!entry) return null;

        // Invert the operation: restore previous state or delete if element was newly added
        const inverseOp: Omit<CrdtOperation, 'vectorClock'> =
            entry.previousOp && entry.previousOp.type !== 'DELETE_ELEMENT'
                ? {
                      id: entry.targetId,
                      type: entry.previousOp.type,
                      nodeId: this.nodeId,
                      timestamp: Date.now(),
                      payload: { ...entry.previousOp.payload }
                  }
                : {
                      id: entry.targetId,
                      type: 'DELETE_ELEMENT',
                      nodeId: this.nodeId,
                      timestamp: Date.now(),
                      payload: { targetId: entry.targetId }
                  };

        // ponytail: apply inverse as a new forward operation with monotonically incremented vector clock
        const invertedOp = this.applyInternal(inverseOp);

        this.redoStack.push({
            targetId: entry.targetId,
            appliedOp: invertedOp,
            previousOp: entry.appliedOp
        });
        if (this.redoStack.length > this.maxHistorySize) {
            this.redoStack.shift();
        }

        return invertedOp;
    }

    public redo(): CrdtOperation | null {
        const entry = this.redoStack.pop();
        if (!entry || !entry.previousOp) return null;

        const redoOp: Omit<CrdtOperation, 'vectorClock'> = {
            id: entry.targetId,
            type: entry.previousOp.type,
            nodeId: this.nodeId,
            timestamp: Date.now(),
            payload: { ...entry.previousOp.payload }
        };

        // ponytail: apply redo as a forward operation advancing vector clock
        const reappliedOp = this.applyInternal(redoOp);

        this.undoStack.push({
            targetId: entry.targetId,
            appliedOp: reappliedOp,
            previousOp: entry.appliedOp
        });
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        return reappliedOp;
    }

    public canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    public canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    public clearHistory(): void {
        this.undoStack = [];
        this.redoStack = [];
    }

    public getHistory(): { undoCount: number; redoCount: number } {
        return {
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length
        };
    }

    public mergeRemoteOperation(op: CrdtOperation): boolean {
        const existingOp = this.state.elements[op.id];

        // If we already have this operation, ignore
        if (existingOp) {
            const existingClock = new CrdtVectorClock(existingOp.vectorClock);
            const incomingClock = new CrdtVectorClock(op.vectorClock);

            // If incoming is older or concurrent but lower nodeId, reject
            if (incomingClock.compare(existingClock.getClock()) === 'before') {
                return false;
            }
            if (incomingClock.compare(existingClock.getClock()) === 'concurrent') {
                if (op.nodeId < existingOp.nodeId) {
                    return false;
                }
            }
        }

        this.state.elements[op.id] = op;

        const currentClock = new CrdtVectorClock(this.state.vectorClock);
        currentClock.merge(op.vectorClock);
        this.state.vectorClock = currentClock.getClock();

        return true;
    }

    public getState(): CrdtState {
        return {
            elements: { ...this.state.elements },
            vectorClock: { ...this.state.vectorClock }
        };
    }

    public getElements(includeDeleted: boolean = false): CrdtOperation[] {
        const elements = Object.values(this.state.elements).sort((a, b) => a.timestamp - b.timestamp);
        return includeDeleted ? elements : elements.filter(el => el.type !== 'DELETE_ELEMENT');
    }
}
