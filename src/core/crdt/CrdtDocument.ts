/**
 * CrdtDocument.ts
 * The core CRDT state tree implementation supporting text and drawing operations.
 * Uses a Last-Writer-Wins (LWW) Register strategy combined with Vector Clocks for conflict resolution.
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

export class CrdtDocument {
    private state: CrdtState;
    private nodeId: string;

    constructor(nodeId: string, initialState: CrdtState = { elements: {}, vectorClock: {} }) {
        this.nodeId = nodeId;
        this.state = {
            elements: { ...initialState.elements },
            vectorClock: { ...initialState.vectorClock }
        };
    }

    public applyLocalOperation(op: Omit<CrdtOperation, 'vectorClock'>): CrdtOperation {
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

    public getElements(): CrdtOperation[] {
        return Object.values(this.state.elements).sort((a, b) => a.timestamp - b.timestamp);
    }
}
