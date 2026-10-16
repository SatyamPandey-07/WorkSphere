/**
 * BountyStateMachine.ts
 * Manages the strict lifecycle of a focus bounty 
 * (POSTED -> CLAIMED -> IN_PROGRESS -> REVIEW -> PAID).
 */

export type BountyStatus = 'POSTED' | 'CLAIMED' | 'IN_PROGRESS' | 'REVIEW' | 'PAID' | 'CANCELLED' | 'EXPIRED';

export interface Bounty {
    id: string;
    title: string;
    description: string;
    rewardAmount: number;
    currency: string;
    posterId: string;
    claimerId?: string;
    status: BountyStatus;
    requiredFocusMinutes: number;
    requiredCommitHashes: string[];
    createdAt: number;
    expiresAt: number;
    claimedAt?: number;
    completedAt?: number;
}

export interface StateTransition {
    from: BountyStatus;
    to: BountyStatus;
    condition: (bounty: Bounty, payload: any) => boolean;
}

export class BountyStateMachine {
    private bounties: Map<string, Bounty> = new Map();
    private transitions: StateTransition[] = [
        { from: 'POSTED', to: 'CLAIMED', condition: (b, p) => !!p.claimerId && b.status === 'POSTED' },
        { from: 'CLAIMED', to: 'IN_PROGRESS', condition: (b, p) => !!p.focusSessionStarted },
        { from: 'IN_PROGRESS', to: 'REVIEW', condition: (b, p) => p.focusMinutes >= b.requiredFocusMinutes && p.commitsVerified },
        { from: 'REVIEW', to: 'PAID', condition: (b, p) => p.peerReviewApproved === true },
        { from: 'REVIEW', to: 'IN_PROGRESS', condition: (b, p) => p.peerReviewApproved === false }, // Rejected, back to work
        { from: 'POSTED', to: 'CANCELLED', condition: (b, p) => p.posterId === b.posterId },
        { from: 'CLAIMED', to: 'CANCELLED', condition: (b, p) => p.posterId === b.posterId },
    ];

    public createBounty(bounty: Omit<Bounty, 'id' | 'status' | 'createdAt' | 'expiresAt'>): Bounty {
        const newBounty: Bounty = {
            ...bounty,
            id: crypto.randomUUID(),
            status: 'POSTED',
            createdAt: Date.now(),
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
        };

        this.bounties.set(newBounty.id, newBounty);
        return newBounty;
    }

    public transition(bountyId: string, action: BountyStatus, payload: any): { success: boolean; error?: string; bounty?: Bounty } {
        const bounty = this.bounties.get(bountyId);
        if (!bounty) return { success: false, error: 'Bounty not found' };

        // Check for expiration
        if (Date.now() > bounty.expiresAt && bounty.status !== 'PAID' && bounty.status !== 'CANCELLED') {
            bounty.status = 'EXPIRED';
            return { success: false, error: 'Bounty has expired', bounty };
        }

        const validTransition = this.transitions.find(t =>
            t.from === bounty.status && t.to === action && t.condition(bounty, payload)
        );

        if (!validTransition) {
            return { success: false, error: `Invalid transition from ${bounty.status} to ${action}` };
        }

        bounty.status = action;

        if (action === 'CLAIMED') {
            bounty.claimerId = payload.claimerId;
            bounty.claimedAt = Date.now();
        } else if (action === 'REVIEW') {
            bounty.completedAt = Date.now();
        }

        return { success: true, bounty };
    }

    public getBounty(id: string): Bounty | undefined {
        return this.bounties.get(id);
    }

    public getActiveBounties(): Bounty[] {
        return Array.from(this.bounties.values()).filter(b =>
            ['POSTED', 'CLAIMED', 'IN_PROGRESS', 'REVIEW'].includes(b.status)
        );
    }
}
