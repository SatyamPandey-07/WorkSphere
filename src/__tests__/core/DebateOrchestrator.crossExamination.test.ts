import {
    DebateOrchestrator,
    CrossExaminationClaim,
} from '@/core/agents/debate/DebateOrchestrator';
import { ConsensusResolver } from '@/core/agents/debate/ConsensusResolver';

describe('DebateOrchestrator Adversarial Cross-Examination Phase (#5775)', () => {
    describe('parseConcession', () => {
        it('detects and parses full factual concessions in agent rebuttals', () => {
            const rebuttal = 'As The Social Networker, upon reviewing the recent telemetry log, I must concede that recent telemetry shows a significant drop to 4 Mbps during peak hours. I accept this correction and adjust my rating.';
            const result = DebateOrchestrator.parseConcession(rebuttal, 15);

            expect(result.isConceded).toBe(true);
            expect(result.concessionFactor).toBe(1.0);
            expect(result.scorePenalty).toBe(15);
            expect(result.reasoning).toContain('conceded the factual challenge');
        });

        it('detects partial concessions when mitigating evidence is cited', () => {
            const rebuttal = 'I admit that the telemetry does show lower speeds, but I stand by my overall evaluation as an isolated incident.';
            const result = DebateOrchestrator.parseConcession(rebuttal, 20);

            expect(result.isConceded).toBe(true);
            expect(result.concessionFactor).toBe(0.5);
            expect(result.scorePenalty).toBe(10);
        });

        it('identifies substantiated rebuttals without conceding', () => {
            const rebuttal = 'As The Focus Advocate, I stand by my evaluation. Our verified independent speed tests confirm 100 Mbps dedicated fiber on the secondary subnet, refuting the critique.';
            const result = DebateOrchestrator.parseConcession(rebuttal, 15);

            expect(result.isConceded).toBe(false);
            expect(result.concessionFactor).toBe(0.0);
            expect(result.scorePenalty).toBe(0);
        });
    });

    describe('executeCrossExamination', () => {
        it('executes targeted cross-examination where Critic questions Advocate regarding questionable WiFi telemetry', async () => {
            const orchestrator = new DebateOrchestrator(1);

            const claim: CrossExaminationClaim = {
                metric: 'wifiSpeed',
                statement: 'You claimed 100 Mbps WiFi, but recent telemetry logged 4 Mbps',
                conflictingEvidence: 'Recent telemetry logged 4 Mbps during peak hours',
                severity: 15,
            };

            const result = await orchestrator.executeCrossExamination(
                'FOCUS_ADVOCATE',
                'SOCIAL_NETWORKER',
                claim
            );

            expect(result.challenger).toBe('FOCUS_ADVOCATE');
            expect(result.respondent).toBe('SOCIAL_NETWORKER');
            expect(result.claim).toBe(claim.statement);
            expect(result.question).toContain('The Focus Advocate');
            expect(result.question).toContain('The Social Networker');
            expect(result.question).toContain('100 Mbps WiFi, but recent telemetry logged 4 Mbps');

            // Respondent concedes the telemetry discrepancy
            expect(result.isConceded).toBe(true);
            expect(result.scorePenalty).toBe(15);
            expect(result.concessionFactor).toBe(1.0);
            expect(result.rebuttal).toContain('concede that recent telemetry shows a significant drop to 4 Mbps');
        });

        it('handles substantiated claims without penalizing respondent score', async () => {
            const orchestrator = new DebateOrchestrator(1);

            const result = await orchestrator.executeCrossExamination(
                'BUDGET_CONSCIOUS',
                'FOCUS_ADVOCATE',
                'The quiet zone acoustic isolation claims are verified'
            );

            expect(result.challenger).toBe('BUDGET_CONSCIOUS');
            expect(result.respondent).toBe('FOCUS_ADVOCATE');
            expect(result.isConceded).toBe(false);
            expect(result.scorePenalty).toBe(0);
            expect(result.rebuttal).toContain('stand by');
        });
    });

    describe('runDebate with Cross-Examination Phase & Consensus Resolution', () => {
        it('adjusts final consensus scores downwards when respondent concedes during cross-examination', async () => {
            const orchestrator = new DebateOrchestrator(2);
            const resolver = new ConsensusResolver();

            const venueData = {
                id: 'venue-123',
                name: 'Urban Hive Coworking',
                price: 15,
                noiseLevel: 'moderate',
                wifiSpeed: 100,
            };

            const debateResult = await orchestrator.runDebate(venueData, {
                crossExaminations: [
                    {
                        challenger: 'FOCUS_ADVOCATE',
                        respondent: 'SOCIAL_NETWORKER',
                        claim: 'You claimed 100 Mbps WiFi, but recent telemetry logged 4 Mbps discrepancy',
                    },
                ],
            });

            expect(debateResult.crossExaminations).toBeDefined();
            expect(debateResult.crossExaminations!.length).toBe(1);

            const crossExam = debateResult.crossExaminations![0];
            expect(crossExam.isConceded).toBe(true);
            expect(crossExam.scorePenalty).toBe(15);

            // Pre-cross-exam score for SOCIAL_NETWORKER was higher than adjusted finalScore
            expect(debateResult.preCrossExamScores).toBeDefined();
            expect(debateResult.finalScores.SOCIAL_NETWORKER).toBe(
                debateResult.preCrossExamScores!.SOCIAL_NETWORKER - 15
            );

            // ConsensusResolver incorporates the adjusted score and notes the concession
            const consensus = resolver.resolveConsensus(debateResult);
            expect(consensus.crossExaminationConcessions).toBe(1);
            expect(consensus.consensusStatement).toContain('Factual cross-examination adjustment');
            expect(consensus.consensusStatement).toContain('conceded regarding');
        });

        it('runs auto cross-examination between top advocate and top critic when enabled', async () => {
            const orchestrator = new DebateOrchestrator(1);

            const venueData = {
                id: 'venue-456',
                name: 'Loft Lab',
                wifiTelemetryDiscrepancy: 'You claimed 100 Mbps WiFi, but recent telemetry logged 4 Mbps',
            };

            const debateResult = await orchestrator.runDebate(venueData, {
                autoCrossExamine: true,
            });

            expect(debateResult.crossExaminations).toBeDefined();
            expect(debateResult.crossExaminations!.length).toBeGreaterThanOrEqual(1);

            const exam = debateResult.crossExaminations![0];
            expect(exam.isConceded).toBe(true);
        });
    });

    describe('Zero-Variance Division Prevention & Epistemic Variance (#5775)', () => {
        it('calculates zero epistemic variance when all scores are identical without division by zero', () => {
            const identicalScores = [85, 85, 85];
            const variance = DebateOrchestrator.calculateEpistemicVariance(identicalScores);
            expect(variance).toBe(0.0);
            expect(Number.isFinite(variance)).toBe(true);
        });

        it('handles single-element, empty, or non-finite score arrays gracefully', () => {
            expect(DebateOrchestrator.calculateEpistemicVariance([])).toBe(0.0);
            expect(DebateOrchestrator.calculateEpistemicVariance([70])).toBe(0.0);
            expect(DebateOrchestrator.calculateEpistemicVariance([NaN, 80, NaN])).toBe(0.0);
            expect(DebateOrchestrator.calculateEpistemicVariance([80, Infinity, 80])).toBe(0.0);
        });

        it('accurately computes sample variance for distinct scores', () => {
            // Mean = 70. Differences: -10, 0, 10. Squared: 100, 0, 100. Sum = 200. Variance = 200 / 2 = 100.
            const scores = [60, 70, 80];
            const variance = DebateOrchestrator.calculateEpistemicVariance(scores);
            expect(variance).toBe(100.0);
        });

        it('updateBayesianConviction handles zero/NaN temperature and matching peer scores without NaN drift', () => {
            const conviction = DebateOrchestrator.updateBayesianConviction(
                85,
                [
                    { persona: 'FOCUS_ADVOCATE', score: 85 },
                    { persona: 'SOCIAL_NETWORKER', score: 85 },
                ],
                'BUDGET_CONSCIOUS',
                { temperature: 0, plasticityRate: NaN }
            );

            expect(conviction.posteriorScore).toBe(85);
            expect(conviction.shiftDelta).toBe(0);
            expect(conviction.confidence).toBe(1.0);
            expect(Number.isFinite(conviction.posteriorScore)).toBe(true);
        });

        it('runDebate tracks epistemicVariance and converges early on matching scores', async () => {
            const orchestrator = new DebateOrchestrator(3, {
                convergenceThreshold: 5.0,
            });

            const venueData = {
                id: 'venue-conv-test',
                name: 'Consensus Haven',
            };

            const result = await orchestrator.runDebate(venueData, { maxRounds: 3 });

            expect(result.epistemicVariance).toBeDefined();
            expect(Number.isFinite(result.epistemicVariance)).toBe(true);
            expect(result.epistemicVariance).toBeGreaterThanOrEqual(0.0);
        });
    });
});

