/**
 * MonacoCRDTAdapter.ts
 * Bridges Monaco editor with a custom RGA (Replicated Growable Array) CRDT
 * for conflict-free text synchronization.
 */

export interface CRDTNode {
    id: string;
    parentId: string | null;
    value: string;
    tombstone: boolean;
    lamport: number;
}

export interface CRDTOperation {
    type: 'insert' | 'delete';
    nodeId: string;
    parentId?: string | null;
    value?: string;
    lamport: number;
    authorId: string;
}

export class MonacoCRDTAdapter {
    private nodes: Map<string, CRDTNode> = new Map();
    private lamportClock: number = 0;
    private authorId: string;
    private onRemoteOperation?: (op: CRDTOperation) => void;

    constructor(authorId: string) {
        this.authorId = authorId;
        // Initialize with a root node
        this.nodes.set('root', {
            id: 'root',
            parentId: null,
            value: '',
            tombstone: false,
            lamport: 0,
        });
    }

    public setRemoteOperationHandler(handler: (op: CRDTOperation) => void) {
        this.onRemoteOperation = handler;
    }

    private generateId(): string {
        return `${this.authorId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private incrementLamport(): number {
        this.lamportClock += 1;
        return this.lamportClock;
    }

    public insertText(afterId: string, value: string): CRDTOperation {
        const nodeId = this.generateId();
        const lamport = this.incrementLamport();

        const newNode: CRDTNode = {
            id: nodeId,
            parentId: afterId,
            value,
            tombstone: false,
            lamport,
        };

        this.nodes.set(nodeId, newNode);

        const op: CRDTOperation = {
            type: 'insert',
            nodeId,
            parentId: afterId,
            value,
            lamport,
            authorId: this.authorId,
        };

        if (this.onRemoteOperation) {
            this.onRemoteOperation(op);
        }

        return op;
    }

    public deleteText(nodeId: string): CRDTOperation {
        const node = this.nodes.get(nodeId);
        if (!node || node.tombstone) {
            throw new Error('Cannot delete non-existent or already deleted node');
        }

        node.tombstone = true;
        const lamport = this.incrementLamport();

        const op: CRDTOperation = {
            type: 'delete',
            nodeId,
            lamport,
            authorId: this.authorId,
        };

        if (this.onRemoteOperation) {
            this.onRemoteOperation(op);
        }

        return op;
    }

    public applyRemoteOperation(op: CRDTOperation): void {
        if (op.lamport > this.lamportClock) {
            this.lamportClock = op.lamport;
        }

        if (op.type === 'insert') {
            const newNode: CRDTNode = {
                id: op.nodeId,
                parentId: op.parentId || null,
                value: op.value || '',
                tombstone: false,
                lamport: op.lamport,
            };
            this.nodes.set(op.nodeId, newNode);
        } else if (op.type === 'delete') {
            const node = this.nodes.get(op.nodeId);
            if (node) {
                node.tombstone = true;
            }
        }
    }

    public getText(): string {
        let text = '';
        const visited = new Set<string>();

        const traverse = (nodeId: string) => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);

            const node = this.nodes.get(nodeId);
            if (!node) return;

            if (!node.tombstone && node.id !== 'root') {
                text += node.value;
            }

            // Find children and sort by lamport timestamp for deterministic ordering
            const children = Array.from(this.nodes.values())
                .filter((n) => n.parentId === nodeId)
                .sort((a, b) => a.lamport - b.lamport);

            for (const child of children) {
                traverse(child.id);
            }
        };

        traverse('root');
        return text;
    }

    public getState(): Map<string, CRDTNode> {
        return new Map(this.nodes);
    }
}
