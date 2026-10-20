import { NextRequest } from 'next/server';
import {
    POST,
    _resetBountiesRouteForTesting,
    _getRouteStateForTesting
} from '@/app/api/bounties/payout/route';
import { BountyEscrow } from '@/core/ledger/BountyEscrow';

describe('Bounties Payout & Escrow API (#6701)', () => {
    const TEST_POSTER = '550e8400-e29b-41d4-a716-446655440000';
    const TEST_POSTER_2 = '550e8400-e29b-41d4-a716-446655440001';
    const TEST_CLAIMER = '550e8400-e29b-41d4-a716-446655440002';
    const OTHER_USER = '550e8400-e29b-41d4-a716-446655440003';

    beforeEach(() => {
        // Explicitly initialize test accounts for isolated test execution
        _resetBountiesRouteForTesting({
            [TEST_POSTER]: 1000,
            [TEST_POSTER_2]: 500
        });
        jest.restoreAllMocks();
    });

    afterEach(() => {
        _resetBountiesRouteForTesting();
        jest.restoreAllMocks();
    });

    function createPostRequest(action: string, body: any): NextRequest {
        return new NextRequest('http://localhost:3000/api/bounties/payout?action=' + action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    function createValidCommits(claimerId: string, timestamp: number) {
        return [
            {
                hash: 'a1b2c3d4e5f6',
                author: claimerId,
                timestamp: timestamp + 1000,
                message: 'feat: implement initial core logic for bounty',
                filesChanged: ['src/core/feature.ts'],
                insertions: 25,
                deletions: 5
            },
            {
                hash: 'b2c3d4e5f6a1',
                author: claimerId,
                timestamp: timestamp + 2000,
                message: 'fix: resolve edge-case validation bug',
                filesChanged: ['src/core/feature.ts'],
                insertions: 15,
                deletions: 2
            },
            {
                hash: 'c3d4e5f6a1b2',
                author: claimerId,
                timestamp: timestamp + 3000,
                message: 'refactor: clean up structure and add tests',
                filesChanged: ['src/__tests__/feature.test.ts'],
                insertions: 30,
                deletions: 5
            }
        ];
    }

    const validAstMetrics = {
        functionsAdded: 3,
        functionsModified: 2,
        complexityDelta: 1,
        testCoverageDelta: 10
    };

    describe('A. Canonical Escrow & Bounty ID Consistency', () => {
        it('uses a single canonical ID for both stateMachine and escrow lock', async () => {
            const req = createPostRequest('create', {
                title: 'Build ZKP integration',
                description: 'Implement zero-knowledge verifier',
                rewardAmount: 250,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 45
            });

            const res = await POST(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.bounty).toBeDefined();

            const bountyId = json.bounty.id;
            expect(typeof bountyId).toBe('string');
            expect(bountyId.length).toBeGreaterThan(0);

            const { escrow, stateMachine } = _getRouteStateForTesting();
            const lock = escrow.getLockStatus(bountyId);
            expect(lock).not.toBeNull();
            expect(lock?.bountyId).toBe(bountyId);
            expect(lock?.posterId).toBe(TEST_POSTER);
            expect(lock?.amount).toBe(250);
            expect(lock?.status).toBe('LOCKED');

            const bounty = stateMachine.getBounty(bountyId);
            expect(bounty).toBeDefined();
            expect(bounty?.id).toBe(bountyId);
            expect(bounty?.status).toBe('POSTED');

            // Balances check
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(750);
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(0);
        });

        it('refunds escrow funds if state machine creation throws', async () => {
            const { stateMachine, escrow } = _getRouteStateForTesting();
            const initialBalance = escrow.getUserBalance(TEST_POSTER);

            jest.spyOn(stateMachine, 'createBounty').mockImplementationOnce(() => {
                throw new Error('State machine failed');
            });

            const req = createPostRequest('create', {
                title: 'Failed creation',
                description: 'Testing rollback on failure',
                rewardAmount: 100,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            });

            const res = await POST(req);
            expect(res.status).toBe(500);

            // Escrow funds must be refunded back to poster
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(initialBalance);
        });
    });

    describe('B. Account and Balance Consistency', () => {
        it('unknown accounts remain unfunded (0 balance) by default and reject with 402', async () => {
            // Reset with default runtime state (no test UUIDs seeded)
            _resetBountiesRouteForTesting();
            const { escrow } = _getRouteStateForTesting();

            const UNKNOWN_POSTER = 'a0000000-0000-4000-8000-000000000001';
            expect(escrow.getUserBalance(UNKNOWN_POSTER)).toBe(0);
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(0);

            const req = createPostRequest('create', {
                title: 'Zero Balance Post',
                description: 'Should fail immediately',
                rewardAmount: 100,
                posterId: UNKNOWN_POSTER,
                requiredFocusMinutes: 30
            });

            const res = await POST(req);
            expect(res.status).toBe(402);
            const json = await res.json();
            expect(json.error).toBe('Insufficient funds to post bounty');

            const { stateMachine } = _getRouteStateForTesting();
            expect(stateMachine.getActiveBounties().length).toBe(0);
            expect(escrow.getUserBalance(UNKNOWN_POSTER)).toBe(0);
        });

        it('rejects funded accounts when reward exceeds available balance (402)', async () => {
            const req = createPostRequest('create', {
                title: 'Overspending',
                description: 'Exceeding 1000 balance',
                rewardAmount: 5000,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            });

            const res = await POST(req);
            expect(res.status).toBe(402);
            const json = await res.json();
            expect(json.error).toBe('Insufficient funds to post bounty');

            const { escrow } = _getRouteStateForTesting();
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(1000);
        });

        it('rejects invalid non-UUID poster format (400)', async () => {
            const req = createPostRequest('create', {
                title: 'Invalid UUID',
                description: 'Using legacy string',
                rewardAmount: 50,
                posterId: 'user-1',
                requiredFocusMinutes: 30
            });

            const res = await POST(req);
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toBe('Invalid bounty data');
        });
    });

    describe('C. Valid Bounty Lifecycle Transitions', () => {
        it('executes full valid lifecycle: POSTED -> CLAIMED -> IN_PROGRESS -> REVIEW -> PAID', async () => {
            const { escrow, stateMachine } = _getRouteStateForTesting();
            const posterInitial = escrow.getUserBalance(TEST_POSTER);
            const claimerInitial = escrow.getUserBalance(TEST_CLAIMER);

            // 1. Create
            const createRes = await POST(createPostRequest('create', {
                title: 'Full Lifecycle Bounty',
                description: 'End-to-end flow test',
                rewardAmount: 300,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            }));
            expect(createRes.status).toBe(200);
            const { bounty } = await createRes.json();
            expect(bounty.status).toBe('POSTED');
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(posterInitial - 300);
            expect(escrow.getLockStatus(bounty.id)?.status).toBe('LOCKED');

            // 2. Claim
            const claimRes = await POST(createPostRequest('claim', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER
            }));
            expect(claimRes.status).toBe(200);
            const claimJson = await claimRes.json();
            expect(claimJson.bounty.status).toBe('CLAIMED');
            expect(claimJson.bounty.claimerId).toBe(TEST_CLAIMER);

            // 3. Start Work
            const startRes = await POST(createPostRequest('start-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER
            }));
            expect(startRes.status).toBe(200);
            const startJson = await startRes.json();
            expect(startJson.bounty.status).toBe('IN_PROGRESS');

            // 4. Submit Work
            const commits = createValidCommits(TEST_CLAIMER, claimJson.bounty.claimedAt || Date.now() - 5000);
            const submitRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));
            expect(submitRes.status).toBe(200);
            const submitJson = await submitRes.json();
            expect(submitJson.success).toBe(true);
            expect(submitJson.payoutExecuted).toBe(true);

            // Check final state and ledger
            const currentBounty = stateMachine.getBounty(bounty.id);
            expect(currentBounty?.status).toBe('PAID');

            const lock = escrow.getLockStatus(bounty.id);
            expect(lock?.status).toBe('RELEASED_TO_CLAIMER');
            expect(lock?.amount).toBe(300);
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(claimerInitial + 300);
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(posterInitial - 300);
        });

        it('rejects skipping required lifecycle transitions (POSTED directly to submit-work)', async () => {
            const createRes = await POST(createPostRequest('create', {
                title: 'Skip States',
                description: 'Attempting invalid jump',
                rewardAmount: 100,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            }));
            const { bounty } = await createRes.json();

            const commits = createValidCommits(TEST_CLAIMER, Date.now() - 5000);
            const submitRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 40,
                astMetrics: validAstMetrics
            }));

            expect(submitRes.status).toBe(400);
            const submitJson = await submitRes.json();
            expect(submitJson.error).toContain('Cannot submit work: bounty is in POSTED state');
        });

        it('rejects starting work directly from POSTED without claiming first', async () => {
            const createRes = await POST(createPostRequest('create', {
                title: 'Unclaimed Start',
                description: 'Must claim before start',
                rewardAmount: 100,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            }));
            const { bounty } = await createRes.json();

            const startRes = await POST(createPostRequest('start-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER
            }));

            expect(startRes.status).toBe(403);
        });

        it('returns 404 for unknown bounty ID across all actions', async () => {
            const fakeId = 'a0000000-0000-4000-8000-000000000999';
            for (const action of ['claim', 'start-work', 'submit-work']) {
                const req = createPostRequest(action, {
                    bountyId: fakeId,
                    claimerId: TEST_CLAIMER,
                    commits: [],
                    focusMinutes: 30,
                    astMetrics: validAstMetrics
                });
                const res = await POST(req);
                expect(res.status).toBe(404);
            }
        });
    });

    describe('D. Authorization & Claimer Checks', () => {
        it('prevents poster from claiming their own bounty (400)', async () => {
            const createRes = await POST(createPostRequest('create', {
                title: 'Self Claim',
                description: 'Poster claiming self',
                rewardAmount: 100,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            }));
            const { bounty } = await createRes.json();

            const claimRes = await POST(createPostRequest('claim', {
                bountyId: bounty.id,
                claimerId: TEST_POSTER
            }));

            expect(claimRes.status).toBe(400);
            const json = await claimRes.json();
            expect(json.error).toBe('Poster cannot claim own bounty');
        });

        it('rejects unauthorized user attempting to start work on claimed bounty (403)', async () => {
            const createRes = await POST(createPostRequest('create', {
                title: 'Wrong Worker Start',
                description: 'User C starting User B work',
                rewardAmount: 100,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            }));
            const { bounty } = await createRes.json();

            await POST(createPostRequest('claim', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER
            }));

            const startRes = await POST(createPostRequest('start-work', {
                bountyId: bounty.id,
                claimerId: OTHER_USER
            }));

            expect(startRes.status).toBe(403);
            const json = await startRes.json();
            expect(json.error).toContain('Unauthorized: claimer does not match');
        });

        it('rejects unauthorized user attempting to submit work on another claimer bounty (403)', async () => {
            const createRes = await POST(createPostRequest('create', {
                title: 'Wrong Worker Submit',
                description: 'User C submitting User B work',
                rewardAmount: 100,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            }));
            const { bounty } = await createRes.json();

            await POST(createPostRequest('claim', { bountyId: bounty.id, claimerId: TEST_CLAIMER }));
            await POST(createPostRequest('start-work', { bountyId: bounty.id, claimerId: TEST_CLAIMER }));

            const commits = createValidCommits(OTHER_USER, Date.now() - 5000);
            const submitRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: OTHER_USER,
                commits,
                focusMinutes: 40,
                astMetrics: validAstMetrics
            }));

            expect(submitRes.status).toBe(403);
            const json = await submitRes.json();
            expect(json.error).toContain('Unauthorized: claimer does not match');
        });
    });

    describe('E. Payout Failures, Safe Recovery & Consistency', () => {
        async function setupInProgressBounty() {
            const createRes = await POST(createPostRequest('create', {
                title: 'Failure Recovery Bounty',
                description: 'Testing payout failure branches',
                rewardAmount: 200,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            }));
            const { bounty } = await createRes.json();
            const claimRes = await POST(createPostRequest('claim', { bountyId: bounty.id, claimerId: TEST_CLAIMER }));
            const { bounty: claimedBounty } = await claimRes.json();
            await POST(createPostRequest('start-work', { bountyId: bounty.id, claimerId: TEST_CLAIMER }));
            return claimedBounty;
        }

        it('handles escrow payout failure without falsely marking bounty as paid (leaves in REVIEW and LOCKED)', async () => {
            const bounty = await setupInProgressBounty();
            const { escrow, stateMachine } = _getRouteStateForTesting();

            // Mock payout failure
            jest.spyOn(escrow, 'executePayout').mockReturnValueOnce(false);

            const commits = createValidCommits(TEST_CLAIMER, bounty.claimedAt || Date.now() - 5000);
            const submitRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));

            expect(submitRes.status).toBe(500);
            const json = await submitRes.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe('Escrow payout execution failed');

            // Assert actual state
            const currentBounty = stateMachine.getBounty(bounty.id);
            expect(currentBounty?.status).toBe('REVIEW'); // In REVIEW, ready for retry
            expect(currentBounty?.status).not.toBe('PAID');

            const lock = escrow.getLockStatus(bounty.id);
            expect(lock?.status).toBe('LOCKED');
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(0);
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(800); // 1000 - 200 locked
        });

        it('supports retry after a transient payout failure and completes payment safely', async () => {
            const bounty = await setupInProgressBounty();
            const { escrow, stateMachine } = _getRouteStateForTesting();

            // First attempt: simulate transient escrow failure
            const executePayoutSpy = jest.spyOn(escrow, 'executePayout').mockReturnValueOnce(false);

            const commits = createValidCommits(TEST_CLAIMER, bounty.claimedAt || Date.now() - 5000);
            const attempt1 = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));
            expect(attempt1.status).toBe(500);
            expect(stateMachine.getBounty(bounty.id)?.status).toBe('REVIEW');
            expect(escrow.getLockStatus(bounty.id)?.status).toBe('LOCKED');
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(0);

            // Restore normal executePayout for retry
            executePayoutSpy.mockRestore();

            // Second attempt: retry submission on the bounty currently in REVIEW
            const attempt2 = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));

            expect(attempt2.status).toBe(200);
            const json2 = await attempt2.json();
            expect(json2.success).toBe(true);
            expect(json2.payoutExecuted).toBe(true);

            // Assert state after successful retry
            expect(stateMachine.getBounty(bounty.id)?.status).toBe('PAID');
            expect(escrow.getLockStatus(bounty.id)?.status).toBe('RELEASED_TO_CLAIMER');
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(200);
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(800);
        });

        it('prevents repeated submission and duplicate payout on already paid bounty after retry (409)', async () => {
            const bounty = await setupInProgressBounty();
            const { escrow } = _getRouteStateForTesting();
            const commits = createValidCommits(TEST_CLAIMER, bounty.claimedAt || Date.now() - 5000);

            // Successful payout
            const res1 = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));
            expect(res1.status).toBe(200);
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(200);

            // Repeated submission
            const res2 = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));
            expect(res2.status).toBe(409);
            const json2 = await res2.json();
            expect(json2.error).toContain('already been completed and paid');

            // Balance and lock must not double
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(200);
            expect(escrow.getLockStatus(bounty.id)?.status).toBe('RELEASED_TO_CLAIMER');
        });

        it('compensates and reverses escrow payout if final PAID transition fails (500)', async () => {
            const bounty = await setupInProgressBounty();
            const { escrow, stateMachine } = _getRouteStateForTesting();

            // Mock transition to PAID failure
            const originalTransition = stateMachine.transition.bind(stateMachine);
            jest.spyOn(stateMachine, 'transition').mockImplementation((id, action, payload) => {
                if (action === 'PAID') {
                    return { success: false, error: 'Database locked during transition to PAID' };
                }
                return originalTransition(id, action, payload);
            });

            const commits = createValidCommits(TEST_CLAIMER, bounty.claimedAt || Date.now() - 5000);
            const submitRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));

            expect(submitRes.status).toBe(500);
            const json = await submitRes.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe('Database locked during transition to PAID');

            // Lock must be reversed back to LOCKED and claimer balance reclaimed
            const lock = escrow.getLockStatus(bounty.id);
            expect(lock?.status).toBe('LOCKED');
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(0);
            expect(escrow.getUserBalance(TEST_POSTER)).toBe(800);
            expect(stateMachine.getBounty(bounty.id)?.status).toBe('REVIEW');
        });

        it('recovers exact payout amount and restores lock to LOCKED when claimer has sufficient balance (unit test)', () => {
            const escrow = new BountyEscrow({ [TEST_POSTER]: 1000 });
            const bountyId = '550e8400-e29b-41d4-a716-446655440099';

            expect(escrow.lockFunds(bountyId, TEST_POSTER, 200)).toBe(true);
            expect(escrow.executePayout(bountyId, TEST_CLAIMER)).toBe(true);
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(200);
            expect(escrow.getLockStatus(bountyId)?.status).toBe('RELEASED_TO_CLAIMER');

            // Compensation with sufficient funds
            const reversed = escrow.reversePayout(bountyId, TEST_CLAIMER);
            expect(reversed).toBe(true);
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(0);
            expect(escrow.getLockStatus(bountyId)?.status).toBe('LOCKED');
        });

        it('refuses compensation and leaves lock in RELEASED_TO_CLAIMER when claimer balance is insufficient (unit test)', () => {
            const escrow = new BountyEscrow({ [TEST_POSTER]: 1000 });
            const bountyId = '550e8400-e29b-41d4-a716-446655440099';

            expect(escrow.lockFunds(bountyId, TEST_POSTER, 200)).toBe(true);
            expect(escrow.executePayout(bountyId, TEST_CLAIMER)).toBe(true);
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(200);

            // Simulate claimer spending 150 tokens before compensation, leaving only 50
            (escrow as any).balances.set(TEST_CLAIMER, 50);

            // Compensation must fail rather than deducting partial funds or marking lock as LOCKED
            const reversed = escrow.reversePayout(bountyId, TEST_CLAIMER);
            expect(reversed).toBe(false);
            // Balance must NOT be truncated to 0 or modified
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(50);
            // Lock must NOT be falsely marked LOCKED
            expect(escrow.getLockStatus(bountyId)?.status).toBe('RELEASED_TO_CLAIMER');
        });

        it('honestly reports critical failure and blocks duplicate payout when compensation fails due to depleted claimer balance (integration)', async () => {
            const bounty = await setupInProgressBounty();
            const { escrow, stateMachine } = _getRouteStateForTesting();

            // Spy executePayout to simulate intermediate claimer balance spend
            const originalExecutePayout = escrow.executePayout.bind(escrow);
            jest.spyOn(escrow, 'executePayout').mockImplementation((bId, cId) => {
                const success = originalExecutePayout(bId, cId);
                if (success) {
                    // Claimer spends 150 of the 200 tokens immediately
                    const current = escrow.getUserBalance(cId);
                    (escrow as any).balances.set(cId, current - 150);
                }
                return success;
            });

            // Mock PAID transition failure
            const originalTransition = stateMachine.transition.bind(stateMachine);
            jest.spyOn(stateMachine, 'transition').mockImplementation((id, action, payload) => {
                if (action === 'PAID') {
                    return { success: false, error: 'Simulated crash during PAID transition' };
                }
                return originalTransition(id, action, payload);
            });

            const commits = createValidCommits(TEST_CLAIMER, bounty.claimedAt || Date.now() - 5000);
            const submitRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));

            // Route must return 500 with critical error
            expect(submitRes.status).toBe(500);
            const json = await submitRes.json();
            expect(json.success).toBe(false);
            expect(json.error).toContain('Critical failure: payout was released but final state transition and compensation reversal failed');

            // Verify that lock remains RELEASED_TO_CLAIMER and claimer balance is untouched at 50
            expect(escrow.getLockStatus(bounty.id)?.status).toBe('RELEASED_TO_CLAIMER');
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(50);

            // Re-attempting submission must NOT issue a duplicate payout and must return 409
            const retryRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 35,
                astMetrics: validAstMetrics
            }));
            expect(retryRes.status).toBe(409);
            const retryJson = await retryRes.json();
            expect(retryJson.error).toContain('Cannot process review retry: escrow lock is not active');

            // Claimer balance must remain strictly at 50 (never credited twice)
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(50);
        });
    });

    describe('F. Verification & Focus Time Requirements', () => {
        it('rejects submission with insufficient focus minutes without triggering payout (400)', async () => {
            const createRes = await POST(createPostRequest('create', {
                title: 'High Focus Bounty',
                description: 'Requires 60 minutes',
                rewardAmount: 200,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 60
            }));
            const { bounty } = await createRes.json();
            const claimRes = await POST(createPostRequest('claim', { bountyId: bounty.id, claimerId: TEST_CLAIMER }));
            const { bounty: claimedBounty } = await claimRes.json();
            await POST(createPostRequest('start-work', { bountyId: bounty.id, claimerId: TEST_CLAIMER }));

            const commits = createValidCommits(TEST_CLAIMER, claimedBounty.claimedAt || Date.now() - 5000);
            const submitRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits,
                focusMinutes: 20, // Less than required 60
                astMetrics: validAstMetrics
            }));

            expect(submitRes.status).toBe(400);
            const json = await submitRes.json();
            expect(json.success).toBe(false);
            expect(json.message).toContain('Insufficient focus time');

            const { escrow, stateMachine } = _getRouteStateForTesting();
            expect(stateMachine.getBounty(bounty.id)?.status).toBe('IN_PROGRESS');
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(0);
            expect(escrow.getLockStatus(bounty.id)?.status).toBe('LOCKED');
        });

        it('rejects submission with failed commit verification without triggering payout (400)', async () => {
            const createRes = await POST(createPostRequest('create', {
                title: 'Verifier Check',
                description: 'Invalid commits',
                rewardAmount: 200,
                posterId: TEST_POSTER,
                requiredFocusMinutes: 30
            }));
            const { bounty } = await createRes.json();
            await POST(createPostRequest('claim', { bountyId: bounty.id, claimerId: TEST_CLAIMER }));
            await POST(createPostRequest('start-work', { bountyId: bounty.id, claimerId: TEST_CLAIMER }));

            // Empty commits
            const submitRes = await POST(createPostRequest('submit-work', {
                bountyId: bounty.id,
                claimerId: TEST_CLAIMER,
                commits: [],
                focusMinutes: 45,
                astMetrics: validAstMetrics
            }));

            expect(submitRes.status).toBe(400);
            const json = await submitRes.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe('Work verification failed');

            const { escrow, stateMachine } = _getRouteStateForTesting();
            expect(stateMachine.getBounty(bounty.id)?.status).toBe('IN_PROGRESS');
            expect(escrow.getUserBalance(TEST_CLAIMER)).toBe(0);
            expect(escrow.getLockStatus(bounty.id)?.status).toBe('LOCKED');
        });
    });
});
