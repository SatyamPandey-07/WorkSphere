/**
 * route.ts
 * API endpoint to initialize the escrow lock, validate the Git commit 
 * proofs, and trigger the final settlement phase.
 */

import { NextRequest, NextResponse } from 'next/server';
import { BountyStateMachine } from '@/core/bounties/BountyStateMachine';
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

            // Lock funds in escrow
            const locked = escrow.lockFunds(crypto.randomUUID(), parsed.data.posterId, parsed.data.rewardAmount);
            if (!locked) {
                return NextResponse.json({ error: 'Insufficient funds to post bounty' }, { status: 402 });
            }

            const bounty = stateMachine.createBounty({ ...parsed.data, currency: 'WST', requiredCommitHashes: [] });
            return NextResponse.json({ success: true, bounty });
        }

        if (action === 'submit-work') {
            const parsed = SubmitWorkSchema.safeParse(body);
            if (!parsed.success) return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });

            const bounty = stateMachine.getBounty(parsed.data.bountyId);
            if (!bounty) return NextResponse.json({ error: 'Bounty not found' }, { status: 404 });

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
                    message: `Insufficient focus time. Required: ${bounty.requiredFocusMinutes}m, Actual: ${parsed.data.focusMinutes}m`
                }, { status: 400 });
            }

            // Transition to REVIEW (or auto-approve for demo)
            const transition = stateMachine.transition(bounty.id, 'REVIEW', {
                focusMinutes: parsed.data.focusMinutes,
                commitsVerified: true
            });

            if (!transition.success) {
                return NextResponse.json({ error: transition.error }, { status: 400 });
            }

            // Auto-approve peer review for this demo and execute payout
            const payoutSuccess = escrow.executePayout(bounty.id, parsed.data.claimerId);
            stateMachine.transition(bounty.id, 'PAID', { peerReviewApproved: true });

            return NextResponse.json({
                success: true,
                message: 'Bounty completed and payout executed!',
                verificationScore: verification.score,
                payoutExecuted: payoutSuccess
            });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    } catch (error: any) {
        console.error('[Bounties API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
