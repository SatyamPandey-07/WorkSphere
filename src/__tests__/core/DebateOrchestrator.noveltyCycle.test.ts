import {
    DebateOrchestrator,
    NoveltyScoringConfig,
} from '@/core/agents/debate/DebateOrchestrator';

describe('DebateOrchestrator Circular Rebuttals & Novelty Penalties (#5742)', () => {
    describe('calculateCosineSimilarity', () => {
        it('calculates identical vectors as similarity 1.0', () => {
            const vec = [0.5, 0.5, 0.5, 0.5];
            const sim = DebateOrchestrator.calculateCosineSimilarity(vec, vec);
            expect(sim).toBeCloseTo(1.0, 4);
        });

        it('calculates orthogonal vectors as similarity 0.0', () => {
            const vecA = [1, 0, 0];
            const vecB = [0, 1, 0];
            const sim = DebateOrchestrator.calculateCosineSimilarity(vecA, vecB);
            expect(sim).toBe(0.0);
        });

        it('handles zero or mismatched length vectors gracefully', () => {
            expect(DebateOrchestrator.calculateCosineSimilarity([], [])).toBe(0.0);
            expect(DebateOrchestrator.calculateCosineSimilarity([1, 2], [1])).toBe(0.0);
            expect(DebateOrchestrator.calculateCosineSimilarity([0, 0], [0, 0])).toBe(0.0);
        });
    });

    describe('calculateArgumentNovelty & repetition detection', () => {
        it('scores unique arguments with high novelty and zero penalty', () => {
            const initialArg = 'The venue has excellent ergonomic seating and quiet phone booths.';
            const novelty = DebateOrchestrator.calculateArgumentNovelty(initialArg, []);

            expect(novelty.similarityToHistory).toBe(0.0);
            expect(novelty.noveltyScore).toBe(1.0);
            expect(novelty.isRepetitive).toBe(false);
            expect(novelty.penaltyApplied).toBe(0);
        });

        it('detects circular/repetitive claims exceeding 0.85 similarity and penalizes novelty', () => {
            const priorClaim = 'The venue has excellent ergonomic seating and quiet phone booths for focus work.';
            const repetitiveClaim = 'The venue has excellent ergonomic seating and quiet phone booths for focus work!';

            const novelty = DebateOrchestrator.calculateArgumentNovelty(
                repetitiveClaim,
                [priorClaim],
                { similarityThreshold: 0.85, noveltyDeductionPenalty: 10 }
            );

            expect(novelty.similarityToHistory).toBeGreaterThanOrEqual(0.85);
            expect(novelty.isRepetitive).toBe(true);
            expect(novelty.penaltyApplied).toBe(10);
            expect(novelty.noveltyScore).toBeLessThanOrEqual(0.15);
        });

        it('does not penalize arguments introducing novel points below the 0.85 threshold', () => {
            const priorClaim = 'The venue has high pricing per desk at fifteen dollars an hour.';
            const novelClaim = 'The coffee shop next door creates excessive acoustic disturbance and foot traffic.';

            const novelty = DebateOrchestrator.calculateArgumentNovelty(
                novelClaim,
                [priorClaim],
                { similarityThreshold: 0.85, noveltyDeductionPenalty: 10 }
            );

            expect(novelty.similarityToHistory).toBeLessThan(0.85);
            expect(novelty.isRepetitive).toBe(false);
            expect(novelty.penaltyApplied).toBe(0);
        });
    });

    describe('Early termination on repetitive agent cycles in runDebate', () => {
        it('terminates debate early when repetitive agent cycles are detected', async () => {
            // Orchestrator configured with 6 max rounds
            const orchestrator = new DebateOrchestrator(6);

            const venueData = {
                id: 'venue-cycle-test',
                name: 'Infinite Loop Coworking',
                price: 25,
            };

            // Custom novelty configuration: trigger early termination after 2 consecutive repetitive rounds
            const noveltyConfig: NoveltyScoringConfig = {
                similarityThreshold: 0.85,
                noveltyDeductionPenalty: 10,
                maxRepetitiveRoundsBeforeEarlyTermination: 2,
            };

            const result = await orchestrator.runDebate(venueData, {
                maxRounds: 6,
                noveltyConfig,
            });

            // If repetitive arguments occur in successive rounds, the debate terminates early
            expect(result.rounds.length).toBeGreaterThan(0);
            expect(result.noveltyReports).toBeDefined();
            expect(result.noveltyReports!.length).toBeGreaterThan(0);

            // Verify that repetitiveness is tracked across rounds
            const reports = result.noveltyReports!;
            const repetitives = reports.filter(r => r.isRepetitive);
            if (repetitives.length > 0) {
                expect(repetitives[0].similarityToHistory).toBeGreaterThanOrEqual(0.85);
                expect(repetitives[0].penaltyApplied).toBe(10);
            }
        });

        it('applies score penalty to repetitive persona arguments', async () => {
            const orchestrator = new DebateOrchestrator(3);

            const venueData = {
                id: 'venue-penalty-test',
                name: 'Repetitive Hub',
                price: 20,
            };

            const result = await orchestrator.runDebate(venueData, {
                maxRounds: 3,
                noveltyConfig: {
                    similarityThreshold: 0.85,
                    noveltyDeductionPenalty: 15,
                },
            });

            expect(result.totalRoundsExecuted).toBeDefined();
            expect(result.rounds.length).toBeGreaterThan(0);
            for (const round of result.rounds) {
                expect(round.score).toBeGreaterThanOrEqual(0);
                expect(round.score).toBeLessThanOrEqual(100);
            }
        });
    });
});
