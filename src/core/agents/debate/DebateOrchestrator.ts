/**
 * DebateOrchestrator.ts
 * Manages the multi-turn conversation loop, Bayesian belief updating, persona conviction state,
 * and adversarial cross-examination phases between debating AI personas (#5775).
 * Coordinates multi-agent deliberation, tracks epistemic conviction revisions, and calculates convergence.
 */

import { PersonaType, PERSONA_CONFIGS, getPersonaPrompt } from './AgentPersona';

export interface BayesianConvictionConfig {
    plasticityRate: number; // alpha_i in (0, 1): learning rate / epistemic openness
    temperature: number;    // sigma: temperature scaling parameter for bounded tanh response
    convergenceThreshold: number; // epsilon: max score discrepancy for early consensus termination
    credibilityMatrix?: Partial<Record<PersonaType, Partial<Record<PersonaType, number>>>>; // kappa_ij
}

export interface PersonaConvictionState {
    priorScore: number;
    posteriorScore: number;
    confidence: number; // 0.0 - 1.0
    shiftDelta: number;
    reasoning?: string;
}

export interface DebateRound {
    roundNumber: number;
    persona: PersonaType;
    argument: string;
    score: number; // 0-100 (posterior score for this round)
    conviction?: PersonaConvictionState;
}

export interface CrossExaminationClaim {
    metric?: string; // e.g. 'wifiSpeed', 'noiseLevel', 'price', etc.
    statement: string; // The original claim made
    conflictingEvidence?: string; // e.g. 'Telemetry logged 4 Mbps'
    severity?: number; // 1-30 impact penalty scale (default: 15)
}

export interface CrossExaminationResult {
    challenger: PersonaType;
    respondent: PersonaType;
    claim: string;
    question: string;
    rebuttal: string;
    isConceded: boolean;
    concessionFactor: number; // 0.0 (no concession/substantiated) to 1.0 (fully conceded)
    scorePenalty: number;     // 0 to 30 points deducted from respondent score
    reasoning: string;
    timestamp: number;
}

export interface ArgumentNoveltyReport {
    persona: PersonaType;
    roundNumber: number;
    argument: string;
    similarityToHistory: number; // Max cosine similarity against prior persona arguments
    noveltyScore: number;       // Novelty score in [0.0, 1.0]
    isRepetitive: boolean;      // True if similarityToHistory >= 0.85
    penaltyApplied: number;     // Penalty points deducted from persona score
}

export interface NoveltyScoringConfig {
    similarityThreshold?: number;     // Repetition threshold, default: 0.85
    noveltyDeductionPenalty?: number; // Score deduction when threshold exceeded, default: 10
    maxRepetitiveRoundsBeforeEarlyTermination?: number; // Early stop when cycles occur across personas, default: 2
}

export interface DebateResult {
    rounds: DebateRound[];
    finalScores: Record<PersonaType, number>;
    convictionTrajectories?: Record<PersonaType, number[]>;
    hasConverged?: boolean;
    totalRoundsExecuted?: number;
    crossExaminations?: CrossExaminationResult[];
    preCrossExamScores?: Record<PersonaType, number>;
    noveltyReports?: ArgumentNoveltyReport[];
    terminatedEarlyDueToCircularRebuttal?: boolean;
}

export interface DebateRunOptions {
    maxRounds?: number;
    autoCrossExamine?: boolean;
    noveltyConfig?: NoveltyScoringConfig;
    crossExaminations?: Array<{
        challenger: PersonaType;
        respondent: PersonaType;
        claim: string | CrossExaminationClaim;
    }>;
}

export const DEFAULT_CONVICTION_CONFIG: BayesianConvictionConfig = {
    plasticityRate: 0.30,
    temperature: 20.0,
    convergenceThreshold: 3.0,
    credibilityMatrix: {
        BUDGET_CONSCIOUS: {
            FOCUS_ADVOCATE: 0.85,
            SOCIAL_NETWORKER: 0.70,
        },
        FOCUS_ADVOCATE: {
            BUDGET_CONSCIOUS: 0.75,
            SOCIAL_NETWORKER: 0.60,
        },
        SOCIAL_NETWORKER: {
            BUDGET_CONSCIOUS: 0.80,
            FOCUS_ADVOCATE: 0.75,
        },
    },
};

export class DebateOrchestrator {
    private maxRounds: number;
    private personas: PersonaType[];
    private convictionConfig: BayesianConvictionConfig;

    constructor(
        maxRounds: number = 2,
        convictionConfig: Partial<BayesianConvictionConfig> = {}
    ) {
        this.maxRounds = Math.max(1, maxRounds);
        this.personas = Object.keys(PERSONA_CONFIGS) as PersonaType[];
        this.convictionConfig = {
            ...DEFAULT_CONVICTION_CONFIG,
            ...convictionConfig,
            credibilityMatrix: {
                ...DEFAULT_CONVICTION_CONFIG.credibilityMatrix,
                ...(convictionConfig.credibilityMatrix || {}),
            },
        };
    }

    /**
     * Calculates the Bayesian posterior conviction update for an agent persona given peer scores.
     * Implements bounded epistemic update: S_i^(r+1) = S_i^(r) + alpha_i * sum_{j != i} [ kappa_ij * tanh((S_j^(r) - S_i^(r)) / sigma) * (sigma / 2) ]
     */
    public static updateBayesianConviction(
        currentScore: number,
        peerScores: { persona: PersonaType; score: number }[],
        persona: PersonaType,
        configOverrides: Partial<BayesianConvictionConfig> = {}
    ): PersonaConvictionState {
        const config: BayesianConvictionConfig = {
            ...DEFAULT_CONVICTION_CONFIG,
            ...configOverrides,
            credibilityMatrix: {
                ...DEFAULT_CONVICTION_CONFIG.credibilityMatrix,
                ...(configOverrides.credibilityMatrix || {}),
            },
        };

        const alpha = Math.max(0.01, Math.min(1.0, config.plasticityRate));
        const sigma = Math.max(1.0, config.temperature);

        let totalInfluence = 0;
        let influentialPeersCount = 0;

        for (const peer of peerScores) {
            if (peer.persona === persona) continue;

            const kappa = config.credibilityMatrix?.[persona]?.[peer.persona] ?? 1.0;
            const delta = peer.score - currentScore;

            // Bounded non-linear influence curve
            const tanhResponse = Math.tanh(delta / sigma);
            totalInfluence += kappa * tanhResponse * (sigma * 0.5);
            influentialPeersCount++;
        }

        const shiftDelta = influentialPeersCount > 0 ? alpha * totalInfluence : 0;
        const unclampedPosterior = currentScore + shiftDelta;
        const posteriorScore = Math.max(0, Math.min(100, Math.round(unclampedPosterior * 10) / 10));

        // Confidence inversely scales with epistemic volatility
        const confidence = Math.max(0.1, Math.min(1.0, 1.0 - Math.abs(shiftDelta) / 40.0));

        return {
            priorScore: currentScore,
            posteriorScore,
            confidence: Math.round(confidence * 100) / 100,
            shiftDelta: Math.round(shiftDelta * 10) / 10,
        };
    }

    /**
     * Computes the cosine similarity between two numerical vector embeddings.
     */
    public static calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
            return 0.0;
        }

        let dot = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        if (normA <= 0 || normB <= 0) return 0.0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Generates a normalized semantic bag-of-words / character n-gram term frequency embedding
     * for an argument string, ensuring deterministic semantic similarity computation without external network calls.
     */
    public static generateArgumentEmbedding(text: string, dimensions: number = 128): number[] {
        if (!text || typeof text !== 'string') {
            return new Array(dimensions).fill(0);
        }

        const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const tokens = normalized.split(' ').filter(t => t.length > 1);

        const vector = new Array(dimensions).fill(0);

        // Hash-based feature embedding mapping token & character n-grams
        for (const token of tokens) {
            let hash = 0;
            for (let i = 0; i < token.length; i++) {
                hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
            }
            const bucket = hash % dimensions;
            vector[bucket] += 1.0;
        }

        // Add character 3-grams for phrase and morphological structure matching
        for (let i = 0; i < normalized.length - 2; i++) {
            const gram = normalized.substring(i, i + 3);
            let hash = 0;
            for (let j = 0; j < 3; j++) {
                hash = (hash * 37 + gram.charCodeAt(j)) >>> 0;
            }
            const bucket = hash % dimensions;
            vector[bucket] += 0.5;
        }

        // L2 normalize vector
        let norm = 0;
        for (let i = 0; i < dimensions; i++) {
            norm += vector[i] * vector[i];
        }
        if (norm > 0) {
            const invNorm = 1.0 / Math.sqrt(norm);
            for (let i = 0; i < dimensions; i++) {
                vector[i] *= invNorm;
            }
        }

        return vector;
    }

    /**
     * Evaluates the semantic novelty of an argument against historical persona claims.
     * Deducts novelty score and penalizes score when similarity exceeds the threshold (0.85) (#5742).
     */
    public static calculateArgumentNovelty(
        currentArgument: string,
        historicalArguments: string[],
        config: NoveltyScoringConfig = {}
    ): ArgumentNoveltyReport & { currentEmbedding: number[] } {
        const threshold = config.similarityThreshold ?? 0.85;
        const penaltyAmount = config.noveltyDeductionPenalty ?? 10;
        const currentEmbedding = DebateOrchestrator.generateArgumentEmbedding(currentArgument);

        if (!historicalArguments || historicalArguments.length === 0) {
            return {
                persona: 'BUDGET_CONSCIOUS' as PersonaType,
                roundNumber: 1,
                argument: currentArgument,
                similarityToHistory: 0.0,
                noveltyScore: 1.0,
                isRepetitive: false,
                penaltyApplied: 0,
                currentEmbedding,
            };
        }

        let maxSimilarity = 0.0;
        for (const prevArg of historicalArguments) {
            const prevEmbedding = DebateOrchestrator.generateArgumentEmbedding(prevArg);
            const sim = DebateOrchestrator.calculateCosineSimilarity(currentEmbedding, prevEmbedding);
            if (sim > maxSimilarity) {
                maxSimilarity = sim;
            }
        }

        const isRepetitive = maxSimilarity >= threshold;
        const noveltyScore = Math.max(0.0, Math.min(1.0, 1.0 - maxSimilarity));
        const penaltyApplied = isRepetitive ? penaltyAmount : 0;

        return {
            persona: 'BUDGET_CONSCIOUS' as PersonaType,
            roundNumber: 1,
            argument: currentArgument,
            similarityToHistory: Math.round(maxSimilarity * 1000) / 1000,
            noveltyScore: Math.round(noveltyScore * 1000) / 1000,
            isRepetitive,
            penaltyApplied,
            currentEmbedding,
        };
    }

    /**
     * Parses an agent's rebuttal to identify factual concessions, determining whether the respondent
     * conceded or substantiated a challenged venue claim (#5775).
     */
    public static parseConcession(
        rebuttal: string,
        severity: number = 15
    ): {
        isConceded: boolean;
        concessionFactor: number;
        scorePenalty: number;
        reasoning: string;
    } {
        const lower = rebuttal.toLowerCase();

        const fullConcessionPhrases = [
            'concede',
            'i concede',
            'concession',
            'i admit',
            'must admit',
            'valid point',
            'fair critique',
            'valid correction',
            'accurate critique',
            'overstated',
            'cannot dispute',
            'must concede',
            'lower than claimed',
            'telemetry does show',
            'correct that',
            'accept this correction',
        ];

        const substantiationPhrases = [
            'stand by',
            'disagree',
            'refute',
            'unsubstantiated',
            'isolated incident',
            'transient dip',
            'dedicated line',
            'independent verification',
            'confirmed by telemetry',
            'test confirms',
            'fully substantiated',
        ];

        const hasConcession = fullConcessionPhrases.some(phrase => lower.includes(phrase));
        const hasSubstantiation = substantiationPhrases.some(phrase => lower.includes(phrase));

        const baseSeverity = Math.max(5, Math.min(30, severity));

        if (hasConcession && !hasSubstantiation) {
            // Full factual concession
            const penalty = baseSeverity;
            return {
                isConceded: true,
                concessionFactor: 1.0,
                scorePenalty: penalty,
                reasoning: 'Respondent fully conceded the factual challenge regarding the questionable venue claim.',
            };
        } else if (hasConcession && hasSubstantiation) {
            // Partial concession with mitigating context
            const penalty = Math.round(baseSeverity * 0.5);
            return {
                isConceded: true,
                concessionFactor: 0.5,
                scorePenalty: penalty,
                reasoning: 'Respondent partially conceded the discrepancy while citing mitigating telemetry context.',
            };
        } else {
            // Defended / substantiated
            return {
                isConceded: false,
                concessionFactor: 0.0,
                scorePenalty: 0,
                reasoning: 'Respondent substantiated the claim against the challenge with verified evidence.',
            };
        }
    }

    /**
     * Executes an adversarial cross-examination round where a challenger persona poses a targeted
     * challenge question to a respondent persona regarding questionable venue claims (#5775).
     */
    public async executeCrossExamination(
        challenger: PersonaType,
        respondent: PersonaType,
        claim: string | CrossExaminationClaim,
        venueData?: Record<string, unknown>
    ): Promise<CrossExaminationResult> {
        const claimObj: CrossExaminationClaim = typeof claim === 'string'
            ? { statement: claim, severity: 15 }
            : { severity: 15, ...claim };

        const { question, rebuttal } = await this.mockCrossExaminationCall(
            challenger,
            respondent,
            claimObj,
            venueData
        );

        const concessionInfo = DebateOrchestrator.parseConcession(
            rebuttal,
            claimObj.severity ?? 15
        );

        return {
            challenger,
            respondent,
            claim: claimObj.statement,
            question,
            rebuttal,
            isConceded: concessionInfo.isConceded,
            concessionFactor: concessionInfo.concessionFactor,
            scorePenalty: concessionInfo.scorePenalty,
            reasoning: concessionInfo.reasoning,
            timestamp: Date.now(),
        };
    }

    /**
     * Simulates a multi-agent debate for a given venue, incorporating Bayesian belief revisions
     * and adversarial cross-examination phases before finalizing consensus scores (#5775).
     */
    public async runDebate(
        venueData: Record<string, unknown>,
        options: DebateRunOptions = {}
    ): Promise<DebateResult> {
        const rounds: DebateRound[] = [];
        const convictionTrajectories: Record<PersonaType, number[]> = {
            BUDGET_CONSCIOUS: [],
            FOCUS_ADVOCATE: [],
            SOCIAL_NETWORKER: [],
        };

        let currentScores: Record<PersonaType, number> = {
            BUDGET_CONSCIOUS: 0,
            FOCUS_ADVOCATE: 0,
            SOCIAL_NETWORKER: 0,
        };

        let hasConverged = false;
        let executedRounds = 0;
        const maxRoundsToRun = options.maxRounds ?? this.maxRounds;

        const personaArgumentHistory: Record<PersonaType, string[]> = {
            BUDGET_CONSCIOUS: [],
            FOCUS_ADVOCATE: [],
            SOCIAL_NETWORKER: [],
        };
        const noveltyReports: ArgumentNoveltyReport[] = [];
        let terminatedEarlyDueToCircularRebuttal = false;
        let consecutiveRepetitiveRounds = 0;

        const noveltyConfig: NoveltyScoringConfig = {
            similarityThreshold: 0.85,
            noveltyDeductionPenalty: 10,
            maxRepetitiveRoundsBeforeEarlyTermination: 2,
            ...options.noveltyConfig,
        };

        for (let round = 1; round <= maxRoundsToRun; round++) {
            executedRounds = round;
            const roundPeerScores: { persona: PersonaType; score: number }[] = [];
            const isFirstRound = round === 1;
            let roundHadRepetition = false;

            for (const persona of this.personas) {
                const prompt = getPersonaPrompt(persona, venueData);

                if (isFirstRound) {
                    // Initial evaluation without prior peer interaction
                    const { argument, score } = await this.mockGroqCall(persona, prompt, 1);
                    currentScores[persona] = score;
                    convictionTrajectories[persona].push(score);
                    roundPeerScores.push({ persona, score });
                    personaArgumentHistory[persona].push(argument);

                    const novelty = DebateOrchestrator.calculateArgumentNovelty(
                        argument,
                        [],
                        noveltyConfig
                    );
                    noveltyReports.push({
                        ...novelty,
                        persona,
                        roundNumber: round,
                    });

                    rounds.push({
                        roundNumber: round,
                        persona,
                        argument,
                        score,
                        conviction: {
                            priorScore: score,
                            posteriorScore: score,
                            confidence: 1.0,
                            shiftDelta: 0,
                        },
                    });
                } else {
                    // Bayesian conviction update using peer scores from prior round
                    const previousScoresList = this.personas.map(p => ({
                        persona: p,
                        score: currentScores[p],
                    }));

                    const conviction = DebateOrchestrator.updateBayesianConviction(
                        currentScores[persona],
                        previousScoresList,
                        persona,
                        this.convictionConfig
                    );

                    const { argument } = await this.mockGroqCall(
                        persona,
                        prompt,
                        round,
                        conviction
                    );

                    // Semantic argument novelty tracking & repetition detection (#5742)
                    const pastArgs = personaArgumentHistory[persona];
                    const novelty = DebateOrchestrator.calculateArgumentNovelty(
                        argument,
                        pastArgs,
                        noveltyConfig
                    );

                    let effectiveScore = conviction.posteriorScore;
                    if (novelty.isRepetitive) {
                        roundHadRepetition = true;
                        // Deduct penalty when argument similarity exceeds 0.85 threshold
                        effectiveScore = Math.max(0, effectiveScore - novelty.penaltyApplied);
                    }

                    noveltyReports.push({
                        ...novelty,
                        persona,
                        roundNumber: round,
                    });
                    personaArgumentHistory[persona].push(argument);

                    currentScores[persona] = effectiveScore;
                    convictionTrajectories[persona].push(effectiveScore);
                    roundPeerScores.push({ persona, score: effectiveScore });

                    rounds.push({
                        roundNumber: round,
                        persona,
                        argument,
                        score: effectiveScore,
                        conviction: {
                            ...conviction,
                            posteriorScore: effectiveScore,
                        },
                    });
                }
            }

            // Early termination on circular rebuttal loops (#5742)
            if (roundHadRepetition) {
                consecutiveRepetitiveRounds++;
                if (consecutiveRepetitiveRounds >= (noveltyConfig.maxRepetitiveRoundsBeforeEarlyTermination ?? 2)) {
                    terminatedEarlyDueToCircularRebuttal = true;
                    break;
                }
            } else {
                consecutiveRepetitiveRounds = 0;
            }

            // Check convergence criterion: max pairwise discrepancy < epsilon
            const currentScoreValues = Object.values(currentScores);
            const scoreSpread = Math.max(...currentScoreValues) - Math.min(...currentScoreValues);
            if (scoreSpread <= this.convictionConfig.convergenceThreshold) {
                hasConverged = true;
                break;
            }
        }

        const preCrossExamScores: Record<PersonaType, number> = {
            BUDGET_CONSCIOUS: Math.round(currentScores.BUDGET_CONSCIOUS),
            FOCUS_ADVOCATE: Math.round(currentScores.FOCUS_ADVOCATE),
            SOCIAL_NETWORKER: Math.round(currentScores.SOCIAL_NETWORKER),
        };

        // Adversarial Cross-Examination Phase (#5775)
        const crossExaminations: CrossExaminationResult[] = [];
        const crossExamsToRun = options.crossExaminations ?? [];

        // If autoCrossExamine is requested and no explicit pairs provided, construct adversarial challenge
        if (options.autoCrossExamine && crossExamsToRun.length === 0) {
            // Find highest-scoring persona (advocate) and lowest-scoring persona (critic)
            const sortedPersonas = (Object.keys(currentScores) as PersonaType[])
                .sort((a, b) => currentScores[b] - currentScores[a]);
            const advocate = sortedPersonas[0];
            const critic = sortedPersonas[sortedPersonas.length - 1];

            if (advocate !== critic) {
                const sampleClaim = venueData?.wifiTelemetryDiscrepancy
                    ? String(venueData.wifiTelemetryDiscrepancy)
                    : 'You claimed 100 Mbps WiFi, but recent telemetry logged 4 Mbps';
                crossExamsToRun.push({
                    challenger: critic,
                    respondent: advocate,
                    claim: sampleClaim,
                });
            }
        }

        // Execute cross-examination challenges
        for (const { challenger, respondent, claim } of crossExamsToRun) {
            const crossExamResult = await this.executeCrossExamination(
                challenger,
                respondent,
                claim,
                venueData
            );
            crossExaminations.push(crossExamResult);

            // If conceded, adjust respondent's final consensus score downwards
            if (crossExamResult.isConceded && crossExamResult.scorePenalty > 0) {
                const adjustedScore = Math.max(0, currentScores[respondent] - crossExamResult.scorePenalty);
                currentScores[respondent] = adjustedScore;
            }
        }

        const finalScores: Record<PersonaType, number> = {
            BUDGET_CONSCIOUS: Math.round(currentScores.BUDGET_CONSCIOUS),
            FOCUS_ADVOCATE: Math.round(currentScores.FOCUS_ADVOCATE),
            SOCIAL_NETWORKER: Math.round(currentScores.SOCIAL_NETWORKER),
        };

        return {
            rounds,
            finalScores,
            convictionTrajectories,
            hasConverged,
            totalRoundsExecuted: executedRounds,
            crossExaminations: crossExaminations.length > 0 ? crossExaminations : undefined,
            preCrossExamScores: crossExaminations.length > 0 ? preCrossExamScores : undefined,
            noveltyReports: noveltyReports.length > 0 ? noveltyReports : undefined,
            terminatedEarlyDueToCircularRebuttal,
        };
    }

    private async mockCrossExaminationCall(
        challenger: PersonaType,
        respondent: PersonaType,
        claim: CrossExaminationClaim,
        _venueData?: Record<string, unknown>
    ): Promise<{ question: string; rebuttal: string }> {
        // Simulate inference latency
        await new Promise(resolve => setTimeout(resolve, 200));

        const challengerName = PERSONA_CONFIGS[challenger].name;
        const respondentName = PERSONA_CONFIGS[respondent].name;

        const question = `As ${challengerName}, I directly challenge ${respondentName}: ${claim.statement}. Can you substantiate this against current telemetry?`;

        let rebuttal: string;
        const claimText = (claim.statement + ' ' + (claim.conflictingEvidence || '')).toLowerCase();

        // If claim refers to a known discrepancy (e.g. WiFi 4 Mbps vs 100 Mbps, or false telemetry)
        if (
            claimText.includes('4 mbps') ||
            claimText.includes('discrepancy') ||
            claimText.includes('fals') ||
            claimText.includes('overpriced') ||
            claimText.includes('noise') ||
            claimText.includes('questionable')
        ) {
            rebuttal = `As ${respondentName}, upon reviewing the recent telemetry log, I must concede that recent telemetry shows a significant drop to 4 Mbps during peak hours. I accept this correction and adjust my rating.`;
        } else {
            rebuttal = `As ${respondentName}, I stand by my evaluation. Our verified independent speed tests confirm 100 Mbps dedicated fiber on the secondary subnet, making the critique an isolated incident.`;
        }

        return { question, rebuttal };
    }

    private async mockGroqCall(
        persona: PersonaType,
        _prompt: string,
        round: number,
        conviction?: PersonaConvictionState
    ): Promise<{ argument: string; score: number }> {
        // Simulate network latency
        await new Promise(resolve => setTimeout(resolve, 200));

        const config = PERSONA_CONFIGS[persona];
        let baseScore = 50;

        if (persona === 'BUDGET_CONSCIOUS') baseScore = 75;
        if (persona === 'FOCUS_ADVOCATE') baseScore = 60;
        if (persona === 'SOCIAL_NETWORKER') baseScore = 85;

        const effectiveScore = conviction ? conviction.posteriorScore : baseScore;

        let argument: string;
        if (round === 1 || !conviction) {
            argument = `As ${config.name}, I evaluate this venue with an initial conviction score of ${effectiveScore}/100 based on core weighted criteria.`;
        } else {
            const direction = conviction.shiftDelta >= 0 ? 'upward' : 'downward';
            const deltaAbs = Math.abs(conviction.shiftDelta);
            argument = `As ${config.name}, in round ${round}, I updated my belief from ${conviction.priorScore} to ${conviction.posteriorScore}/100 (${direction} shift of ${deltaAbs} pts, confidence ${(conviction.confidence * 100).toFixed(0)}%) after evaluating peer arguments and counter-evidence.`;
        }

        return { argument, score: effectiveScore };
    }
}
