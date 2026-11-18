/**
 * route.ts
 * API endpoint to initialize the escrow lock, validate the Git commit 
 * proofs, and trigger the final settlement phase.
 */

import { NextRequest, NextResponse } from 'next/server';
import { BountyStateMachine, Bounty } from '@/core/bounties/BountyStateMachine';
import { CommitVerifier } from '@/core/bounties/CommitVerifier';
import { BountyEscrow } from '@/core/ledger/BountyEscrow';
import { z } from 'zod';

const stateMachine = new BountyStateMachine();
const verifier = new CommitVerifier(['fix', 'feat', 'refactor'], 15);
const escrow = new BountyEscrow();

const CreateBountySchema = z.object({
    title: z.string(),
    description: z.string(),
    rewardAmount: z.number().positive(),
    posterId: z.string().uuid(),
    requiredFocusMinutes: z.number().int().min(30)
});

const ClaimBountySchema = z.object({
    bountyId: z.string().uuid(),
    claimerId: z.string().uuid()
});

const StartWorkSchema = z.object({
    bountyId: z.string().uuid(),
    claimerId: z.string().uuid()
});

const SubmitWorkSchema = z.object({
    bountyId: z.string().uuid(),
    claimerId: z.string().uuid(),
    commits: z.array(z.object({
        hash: z.string(),
        author: z.string(),
        timestamp: z.number(),
        message: z.string(),
        filesChanged: z.array(z.string()),
        insertions: z.number(),
        deletions: z.number()
    })),
    focusMinutes: z.number().int(),
    astMetrics: z.object({
        functionsAdded: z.number(),
        functionsModified: z.number(),
        complexityDelta: z.number(),
        testCoverageDelta: z.number()
    })
});

export async function POST(req: NextRequest) {
    try {
        const action = req.nextUrl.searchParams.get('action');
        const body = await req.json();

        if (action === 'create') {
            const parsed = CreateBountySchema.safeParse(body);
            if (!parsed.success) return NextResponse.json({ error: 'Invalid bounty data' }, { status: 400 });

            const bountyId = crypto.randomUUID();

            // Lock funds in escrow using canonical bountyId
            const locked = escrow.lockFunds(bountyId, parsed.data.posterId, parsed.data.rewardAmount);
            if (!locked) {
                return NextResponse.json({ error: 'Insufficient funds to post bounty' }, { status: 402 });
            }

            let bounty: Bounty;
            try {
                bounty = stateMachine.createBounty({
                    id: bountyId,
                    ...parsed.data,
                    currency: 'WST',
                    requiredCommitHashes: []
                });
            } catch (creationError) {
                // Ensure failure to create bounty does not leave an unreachable escrow lock
                escrow.refundPoster(bountyId);
                throw creationError;
            }

            return NextResponse.json({ success: true, bounty });
        }

        if (action === 'claim') {
            const parsed = ClaimBountySchema.safeParse(body);
            if (!parsed.success) return NextResponse.json({ error: 'Invalid claim data' }, { status: 400 });

            const bounty = stateMachine.getBounty(parsed.data.bountyId);
            if (!bounty) return NextResponse.json({ error: 'Bounty not found' }, { status: 404 });

            if (bounty.posterId === parsed.data.claimerId) {
                return NextResponse.json({ error: 'Poster cannot claim own bounty' }, { status: 400 });
            }

            const transition = stateMachine.transition(bounty.id, 'CLAIMED', {
                claimerId: parsed.data.claimerId
            });

            if (!transition.success) {
                return NextResponse.json({ error: transition.error }, { status: 400 });
            }

            return NextResponse.json({ success: true, bounty: transition.bounty });
        }

        if (action === 'start-work') {
            const parsed = StartWorkSchema.safeParse(body);
            if (!parsed.success) return NextResponse.json({ error: 'Invalid start-work data' }, { status: 400 });

            const bounty = stateMachine.getBounty(parsed.data.bountyId);
            if (!bounty) return NextResponse.json({ error: 'Bounty not found' }, { status: 404 });

            if (bounty.claimerId !== parsed.data.claimerId) {
                return NextResponse.json({ error: 'Unauthorized: claimer does not match assigned claimer' }, { status: 403 });
            }

            const transition = stateMachine.transition(bounty.id, 'IN_PROGRESS', {
                focusSessionStarted: true
            });

            if (!transition.success) {
                return NextResponse.json({ error: transition.error }, { status: 400 });
            }

            return NextResponse.json({ success: true, bounty: transition.bounty });
        }

        if (action === 'submit-work') {
            const parsed = SubmitWorkSchema.safeParse(body);
            if (!parsed.success) return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });

            const bounty = stateMachine.getBounty(parsed.data.bountyId);
            if (!bounty) return NextResponse.json({ error: 'Bounty not found' }, { status: 404 });

            if (bounty.status === 'PAID') {
                return NextResponse.json({ error: 'Bounty has already been completed and paid' }, { status: 409 });
            }

            // Submit work is valid for IN_PROGRESS or retrying a previously incomplete REVIEW
            if (bounty.status !== 'IN_PROGRESS' && bounty.status !== 'REVIEW') {
                return NextResponse.json({ error: 'Cannot submit work: bounty is in ' + bounty.status + ' state' }, { status: 400 });
            }

            if (bounty.claimerId !== parsed.data.claimerId) {
                return NextResponse.json({ error: 'Unauthorized: claimer does not match assigned claimer' }, { status: 403 });
            }

            // Verify commits
            const verification = verifier.verifyCommits(
                parsed.data.commits,
                parsed.data.claimerId,
                bounty.claimedAt || 0,
                parsed.data.astMetrics
            );

            if (!verification.verified) {
                return NextResponse.json({
                    success: false,
                    message: 'Work verification failed',
                    score: verification.score,
                    reasons: verification.reasons
                }, { status: 400 });
            }

            // Check focus time
            if (parsed.data.focusMinutes < bounty.requiredFocusMinutes) {
                return NextResponse.json({
                    success: false,
                    message: 'Insufficient focus time. Required: ' + bounty.requiredFocusMinutes + 'm, Actual: ' + parsed.data.focusMinutes + 'm'
                }, { status: 400 });
            }

            // State-machine handling:
            // 1. If currently IN_PROGRESS, transition to REVIEW.
            // 2. If already in REVIEW (from a previous retryable payout failure), verify escrow lock is still active and LOCKED.
            if (bounty.status === 'IN_PROGRESS') {
                const reviewTransition = stateMachine.transition(bounty.id, 'REVIEW', {
                    focusMinutes: parsed.data.focusMinutes,
                    commitsVerified: true
                });

                if (!reviewTransition.success) {
                    return NextResponse.json({ error: reviewTransition.error }, { status: 400 });
                }
            } else if (bounty.status === 'REVIEW') {
                const lock = escrow.getLockStatus(bounty.id);
                if (!lock || lock.status !== 'LOCKED') {
                    return NextResponse.json({
                        error: 'Cannot process review retry: escrow lock is not active'
                    }, { status: 409 });
                }
            }

            // Execute payout in escrow
            const payoutSuccess = escrow.executePayout(bounty.id, parsed.data.claimerId);
            if (!payoutSuccess) {
                return NextResponse.json({
                    success: false,
                    error: 'Escrow payout execution failed'
                }, { status: 500 });
            }

            // Transition to PAID
            const paidTransition = stateMachine.transition(bounty.id, 'PAID', { peerReviewApproved: true });
            if (!paidTransition.success) {
                // Compensating action: reverse the escrow payout so state remains consistent
                const reversed = escrow.reversePayout(bounty.id, parsed.data.claimerId);
                if (!reversed) {
                    console.error('[Bounties API] CRITICAL: Payout succeeded, PAID transition failed, and compensation reversal failed for bounty ' + bounty.id);
                    return NextResponse.json({
                        success: false,
                        error: 'Critical failure: payout was released but final state transition and compensation reversal failed'
                    }, { status: 500 });
                }
                return NextResponse.json({
                    success: false,
                    error: paidTransition.error || 'Failed to record final payout state'
                }, { status: 500 });
            }

            return NextResponse.json({
                success: true,
                message: 'Bounty completed and payout executed!',
                verificationScore: verification.score,
                payoutExecuted: true
            });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    } catch (error: any) {
        console.error('[Bounties API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * Reset route state for testing.
 * @internal
 */
export function _resetBountiesRouteForTesting(initialBalances?: Record<string, number>): void {
    stateMachine.reset();
    escrow.reset(initialBalances);
}

/**
 * Access underlying singletons for testing assertions and fault injection.
 * @internal
 */
export function _getRouteStateForTesting() {
    return { stateMachine, escrow, verifier };
}
