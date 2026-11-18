import {
  TeamMatchmaker,
  CandidateProfile,
  ProjectSquadSpec,
  EMBEDDING_DIMENSION,
  generateSkillEmbedding,
  calculateCosineSimilarity,
  calculateTimezoneOverlap,
  evaluateTimezoneOverlap,
  calculateWeightedMatchScore,
} from '../../core/matchmaking/TeamMatchmaker';

describe('TeamMatchmaker', () => {
  let matchmaker: TeamMatchmaker;

  const projectSpec: ProjectSquadSpec = {
    projectId: 'proj-fintech-mvp',
    title: 'FinTech Decentralized Settlement Engine',
    targetSize: 3,
    requiredRoles: ['FRONTEND', 'BACKEND', 'DEVOPS'],
    requiredSkills: [
      { skill: 'react', minProficiency: 0.8 },
      { skill: 'rust', minProficiency: 0.75 },
      { skill: 'kubernetes', minProficiency: 0.7 },
    ],
    maxTimezoneDeltaHours: 4.0,
    minWeeklyHoursPerMember: 20,
    projectTimezoneOffsetHours: 1.0, // CET
  };

  const candidatePool: CandidateProfile[] = [
    {
      userId: 'u-alice',
      name: 'Alice',
      primaryRole: 'FRONTEND',
      skills: { react: 0.9, typescript: 0.85, css: 0.9 },
      timezoneOffsetHours: 1.0, // CET
      weeklyAvailabilityHours: 25,
      collaborationStyle: 'HYBRID',
    },
    {
      userId: 'u-bob',
      name: 'Bob',
      primaryRole: 'BACKEND',
      skills: { rust: 0.85, postgresql: 0.8, grpc: 0.75 },
      timezoneOffsetHours: 2.0, // EET
      weeklyAvailabilityHours: 30,
      collaborationStyle: 'HYBRID',
    },
    {
      userId: 'u-carol',
      name: 'Carol',
      primaryRole: 'DEVOPS',
      skills: { kubernetes: 0.85, terraform: 0.8, aws: 0.8 },
      timezoneOffsetHours: 1.0, // CET
      weeklyAvailabilityHours: 25,
      collaborationStyle: 'HYBRID',
    },
    {
      userId: 'u-dave',
      name: 'Dave',
      primaryRole: 'BACKEND',
      skills: { python: 0.7, rust: 0.5 },
      timezoneOffsetHours: -8.0, // PST (far away)
      weeklyAvailabilityHours: 15, // Under hours
      collaborationStyle: 'ASYNCHRONOUS',
    },
    {
      userId: 'u-eve',
      name: 'Eve',
      primaryRole: 'FRONTEND',
      skills: { vue: 0.8, html: 0.8 }, // Lacks react >= 0.8
      timezoneOffsetHours: 1.5,
      weeklyAvailabilityHours: 25,
      collaborationStyle: 'SYNCHRONOUS',
    },
  ];

  beforeEach(() => {
    matchmaker = new TeamMatchmaker();
  });

  describe('Team Fitness Evaluation (Backward Compatibility)', () => {
    it('scores ideal balanced squad high across all dimensions (> 90)', () => {
      const idealSquad = [candidatePool[0], candidatePool[1], candidatePool[2]]; // Alice, Bob, Carol
      const score = matchmaker.evaluateTeamFitness(idealSquad, projectSpec);

      expect(score.overallFitnessScore).toBeGreaterThanOrEqual(90);
      expect(score.skillCoverageScore).toBe(100);
      expect(score.roleDiversityScore).toBe(100);
      expect(score.timezoneHarmonyScore).toBe(100);
      expect(score.missingRoles.length).toBe(0);
      expect(score.uncoveredSkills.length).toBe(0);
    });

    it('penalizes team lacking required roles and skills', () => {
      // Squad with 2 frontends and 1 backend (no DevOps, no Kubernetes)
      const flawedSquad = [candidatePool[0], candidatePool[1], candidatePool[4]]; // Alice, Bob, Eve
      const score = matchmaker.evaluateTeamFitness(flawedSquad, projectSpec);

      expect(score.overallFitnessScore).toBeLessThan(85);
      expect(score.missingRoles).toContain('DEVOPS');
      expect(score.uncoveredSkills).toContain('kubernetes');
    });

    it('applies timezone friction penalties when timezone delta exceeds maximum threshold', () => {
      // Dave is PST (-8), Alice is CET (+1) -> delta 9 hours > 4 hours
      const divergentSquad = [candidatePool[0], candidatePool[1], candidatePool[3]]; // Alice, Bob, Dave
      const score = matchmaker.evaluateTeamFitness(divergentSquad, projectSpec);

      expect(score.maxTimezoneSpanHours).toBe(10.0);
      expect(score.timezoneHarmonyScore).toBeLessThan(70);
    });
  });

  describe('Combinatorial Squad Search (Backward Compatibility)', () => {
    it('finds top-ranked squad matching Alice, Bob, and Carol first', () => {
      const topSquads = matchmaker.findOptimalSquads(candidatePool, projectSpec, 1);

      expect(topSquads.length).toBe(1);
      const best = topSquads[0];
      const memberIds = best.squad.map((m) => m.userId);

      expect(memberIds).toContain('u-alice');
      expect(memberIds).toContain('u-bob');
      expect(memberIds).toContain('u-carol');
      expect(best.score.overallFitnessScore).toBeGreaterThanOrEqual(90);
      expect(best.strengths.length).toBeGreaterThan(0);
    });
  });

  describe('Phase 3: 256-Dimensional Skill Embedding', () => {
    it('generates an embedding with exactly 256 numeric dimensions', () => {
      const vec = generateSkillEmbedding({ react: 0.9, typescript: 0.8 });
      expect(vec.length).toBe(EMBEDDING_DIMENSION);
      expect(vec).toBeInstanceOf(Float64Array);
      for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
        expect(Number.isFinite(vec[i])).toBe(true);
      }
    });

    it('normalizes non-zero embeddings to unit length (L2 norm = 1.0)', () => {
      const vec = generateSkillEmbedding({ react: 0.9, rust: 0.8, kubernetes: 0.7 });
      let normSq = 0;
      for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
        normSq += vec[i] * vec[i];
      }
      expect(Math.sqrt(normSq)).toBeCloseTo(1.0, 5);
    });

    it('handles empty skill lists safely returning an all-zero vector', () => {
      const vec1 = generateSkillEmbedding({});
      const vec2 = generateSkillEmbedding([]);
      const vec3 = generateSkillEmbedding(null);
      const vec4 = generateSkillEmbedding(undefined);

      expect(vec1.every((v) => v === 0)).toBe(true);
      expect(vec2.every((v) => v === 0)).toBe(true);
      expect(vec3.every((v) => v === 0)).toBe(true);
      expect(vec4.every((v) => v === 0)).toBe(true);
    });

    it('handles duplicate skills without NaN or Infinity, deduplicating with max proficiency', () => {
      const listWithDups = [
        { skill: 'React', minProficiency: 0.5 },
        { skill: 'react', minProficiency: 0.9 },
        { skill: 'REACT', minProficiency: 0.7 },
      ];
      const vec = generateSkillEmbedding(listWithDups);
      const single = generateSkillEmbedding({ react: 0.9 });

      expect(vec.length).toBe(256);
      expect(calculateCosineSimilarity(vec, single)).toBeCloseTo(1.0, 5);
    });

    it('handles case-insensitive and whitespace normalization', () => {
      const vecA = generateSkillEmbedding({ '  React-Native ': 0.8 });
      const vecB = generateSkillEmbedding({ reactnative: 0.8 });
      expect(calculateCosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
    });

    it('handles unknown skills deterministically via dual-bucket hashing into dimensions 192..255', () => {
      const vecUnknown = generateSkillEmbedding({ esotericLanguageX99: 0.8 });
      expect(vecUnknown.length).toBe(256);
      let normSq = 0;
      for (let i = 0; i < 256; i++) normSq += vecUnknown[i] * vecUnknown[i];
      expect(Math.sqrt(normSq)).toBeCloseTo(1.0, 5);

      // Verify slots below 192 are 0
      for (let i = 0; i < 192; i++) {
        expect(vecUnknown[i]).toBe(0);
      }
      // Non-zero in 192..255
      const hasHashSlot = vecUnknown.slice(192).some((v) => v > 0);
      expect(hasHashSlot).toBe(true);
    });

    it('embeds complementary skills with positive affinity resonance', () => {
      const reactVec = generateSkillEmbedding({ react: 1.0 });
      const nextVec = generateSkillEmbedding({ nextjs: 1.0 });
      const rustVec = generateSkillEmbedding({ rust: 1.0 });

      const reactNextSim = calculateCosineSimilarity(reactVec, nextVec);
      const reactRustSim = calculateCosineSimilarity(reactVec, rustVec);

      // React and Next.js share frontend category and complementary resonance
      expect(reactNextSim).toBeGreaterThan(0.2);
      expect(reactNextSim).toBeGreaterThan(reactRustSim);
    });
  });

  describe('Phase 4: Cosine Similarity', () => {
    it('returns 1.0 for identical non-zero vectors', () => {
      const vecA = generateSkillEmbedding({ react: 0.8, typescript: 0.9 });
      const sim = calculateCosineSimilarity(vecA, vecA);
      expect(sim).toBeCloseTo(1.0, 5);
    });

    it('returns 0.0 for orthogonal vectors', () => {
      const vecA = new Float64Array(256);
      const vecB = new Float64Array(256);
      vecA[10] = 1.0;
      vecB[20] = 1.0;

      const sim = calculateCosineSimilarity(vecA, vecB);
      expect(sim).toBe(0.0);
    });

    it('returns -1.0 for anti-parallel vectors', () => {
      const vecA = new Float64Array(256);
      const vecB = new Float64Array(256);
      vecA[5] = 1.0;
      vecB[5] = -1.0;

      const sim = calculateCosineSimilarity(vecA, vecB);
      expect(sim).toBeCloseTo(-1.0, 5);
    });

    it('returns 0.0 safely for zero vectors', () => {
      const vecZero = new Float64Array(256);
      const vecValid = generateSkillEmbedding({ react: 0.8 });

      expect(calculateCosineSimilarity(vecZero, vecValid)).toBe(0.0);
      expect(calculateCosineSimilarity(vecZero, vecZero)).toBe(0.0);
    });

    it('handles dimension mismatch and invalid non-finite values safely', () => {
      const vec256 = new Float64Array(256);
      const vec128 = new Float64Array(128);
      expect(calculateCosineSimilarity(vec256, vec128)).toBe(0.0);

      const vecNaN = new Float64Array(256);
      vecNaN[0] = NaN;
      expect(calculateCosineSimilarity(vecNaN, vec256)).toBe(0.0);
    });

    it('clamps output strictly within [-1.0, 1.0]', () => {
      const vec = new Float64Array(256);
      vec.fill(0.0625);
      const sim = calculateCosineSimilarity(vec, vec);
      expect(sim).toBeLessThanOrEqual(1.0);
      expect(sim).toBeGreaterThanOrEqual(-1.0);
    });
  });

  describe('Phase 5 & Focused Audit: Timezone Overlap Scoring & Missing Data Handling', () => {
    it('returns 1.0 for identical timezone and standard 9-17 working hours', () => {
      const overlap = calculateTimezoneOverlap(1.0, 1.0);
      expect(overlap).toBeCloseTo(1.0, 4);
    });

    it('calculates proportional overlap for moderate timezone difference', () => {
      // User UTC+3 vs Project UTC+1: 2h difference, 6h overlap out of 8h window = 0.75
      const overlap = calculateTimezoneOverlap(3.0, 1.0);
      expect(overlap).toBeCloseTo(0.75, 2);
    });

    it('returns 0.0 for non-overlapping working-hour windows (maximally separated)', () => {
      // User UTC+12 vs Project UTC-12: 24h separation
      const overlap = calculateTimezoneOverlap(12.0, -12.0);
      expect(overlap).toBe(0.0);

      // User UTC+8 vs Project UTC-8: 16h separation
      const overlap16 = calculateTimezoneOverlap(8.0, -8.0);
      expect(overlap16).toBe(0.0);
    });

    it('handles custom working hours including windows crossing midnight', () => {
      // User works night shift: 22:00 to 06:00 UTC+0
      // Project works 09:00 to 17:00 UTC+0
      const overlap = calculateTimezoneOverlap(
        0,
        0,
        { startHour: 22, endHour: 6 },
        { startHour: 9, endHour: 17 }
      );
      expect(overlap).toBe(0.0);

      // Shift user by 11 hours: night worker in UTC-11 aligns with UTC 0 daytime
      const overlapAligned = calculateTimezoneOverlap(
        -11,
        0,
        { startHour: 22, endHour: 6 },
        { startHour: 9, endHour: 17 }
      );
      expect(overlapAligned).toBeGreaterThan(0.5);
    });

    it('distinguishes actual UTC timezone (0.0) from missing timezone (null/undefined)', () => {
      // Project at UTC 0, Candidate A has confirmed UTC 0 -> overlap 1.0
      const actualUtcEval = evaluateTimezoneOverlap(0, 0);
      expect(actualUtcEval.isTimezoneMissing).toBe(false);
      expect(actualUtcEval.overlapScore).toBe(1.0);

      // Candidate B has missing timezone (null) -> overlap 0.0, isTimezoneMissing = true
      const nullTzEval = evaluateTimezoneOverlap(null, 0);
      expect(nullTzEval.isTimezoneMissing).toBe(true);
      expect(nullTzEval.overlapScore).toBe(0.0);
      expect(nullTzEval.explanation).toContain('Timezone unconfirmed');

      // Candidate C has missing timezone (undefined) -> overlap 0.0, isTimezoneMissing = true
      const undefTzEval = evaluateTimezoneOverlap(undefined, 0);
      expect(undefTzEval.isTimezoneMissing).toBe(true);
      expect(undefTzEval.overlapScore).toBe(0.0);
      expect(undefTzEval.explanation).toContain('Timezone unconfirmed');
    });

    it('identifies missing working hours while preserving known timezone offset', () => {
      // User has confirmed timezone UTC+1, but missing working hours -> uses default 09:00-17:00 with flag
      const evalMissingHours = evaluateTimezoneOverlap(1.0, 1.0, null);
      expect(evalMissingHours.isTimezoneMissing).toBe(false);
      expect(evalMissingHours.isWorkingHoursMissing).toBe(true);
      expect(evalMissingHours.overlapScore).toBe(1.0);
      expect(evalMissingHours.explanation).toContain('(assumed default 09:00-17:00)');
    });

    it('accurately evaluates candidate ranking when candidate has missing timezone vs actual UTC', () => {
      const candidates: CandidateProfile[] = [
        {
          userId: 'u-missing-tz',
          name: 'MissingTz',
          primaryRole: 'FRONTEND',
          skills: { react: 0.9 },
          timezoneOffsetHours: null, // Unspecified
          weeklyAvailabilityHours: 20,
          collaborationStyle: 'HYBRID',
        },
        {
          userId: 'u-actual-utc',
          name: 'ActualUtc',
          primaryRole: 'FRONTEND',
          skills: { react: 0.9 },
          timezoneOffsetHours: 0.0, // Confirmed UTC
          weeklyAvailabilityHours: 20,
          collaborationStyle: 'HYBRID',
        },
      ];

      const projectUtc: ProjectSquadSpec = {
        ...projectSpec,
        projectTimezoneOffsetHours: 0.0,
      };

      const ranked = matchmaker.rankCandidatesForProject(candidates, projectUtc, 2);

      // Confirmed UTC candidate should score strictly higher than missing timezone candidate
      expect(ranked[0].candidate.userId).toBe('u-actual-utc');
      expect(ranked[0].breakdown.isTimezoneMissing).toBe(false);
      expect(ranked[0].breakdown.timezoneOverlap).toBe(1.0);

      expect(ranked[1].candidate.userId).toBe('u-missing-tz');
      expect(ranked[1].breakdown.isTimezoneMissing).toBe(true);
      expect(ranked[1].breakdown.timezoneOverlap).toBe(0.0);
      expect(ranked[1].score).toBeLessThan(ranked[0].score);
    });
  });

  describe('Phase 6 & 7: Weighted Ranking and Top-Five Selection', () => {
    it('ranks candidates using exact weights 0.6 cosine + 0.4 timezone overlap', () => {
      const cosine = 0.8;
      const tz = 0.5;
      const expected = 0.6 * 0.8 + 0.4 * 0.5; // 0.48 + 0.20 = 0.68
      expect(calculateWeightedMatchScore(cosine, tz)).toBeCloseTo(expected, 4);
    });

    it('ranks candidates and returns at most five profiles sorted descending by score', () => {
      const extendedPool: CandidateProfile[] = [
        ...candidatePool,
        {
          userId: 'u-frank',
          name: 'Frank',
          primaryRole: 'SYSTEMS_AI',
          skills: { machine_learning: 0.9, python: 0.9 },
          timezoneOffsetHours: 1.0,
          weeklyAvailabilityHours: 40,
          collaborationStyle: 'HYBRID',
        },
        {
          userId: 'u-grace',
          name: 'Grace',
          primaryRole: 'FRONTEND',
          skills: { react: 0.95, typescript: 0.9 },
          timezoneOffsetHours: 1.0,
          weeklyAvailabilityHours: 35,
          collaborationStyle: 'SYNCHRONOUS',
        },
      ];

      const ranked = matchmaker.rankCandidatesForProject(extendedPool, projectSpec, 5);

      expect(ranked.length).toBeLessThanOrEqual(5);
      expect(ranked.length).toBe(5);

      // Verify descending order
      for (let i = 0; i < ranked.length - 1; i++) {
        expect(ranked[i].score).toBeGreaterThanOrEqual(ranked[i + 1].score);
      }

      // Check breakdown structure
      const top = ranked[0];
      expect(top.breakdown.overallScore).toBe(top.score);
      expect(top.breakdown.skillCosineSimilarity).toBeDefined();
      expect(top.breakdown.timezoneOverlap).toBeDefined();
      expect(top.breakdown.skillExplanation).toBeTruthy();
      expect(top.breakdown.timezoneExplanation).toBeTruthy();
    });

    it('handles empty or fewer than 5 candidates gracefully', () => {
      const empty = matchmaker.rankCandidatesForProject([], projectSpec, 5);
      expect(empty).toEqual([]);

      const twoCandidates = candidatePool.slice(0, 2);
      const rankedTwo = matchmaker.rankCandidatesForProject(twoCandidates, projectSpec, 5);
      expect(rankedTwo.length).toBe(2);
    });

    it('provides deterministic tie-breaking by stable candidate userId', () => {
      // Two candidates with identical skills and timezone
      const tiedCandidates: CandidateProfile[] = [
        {
          userId: 'u-beta',
          name: 'Beta',
          primaryRole: 'FRONTEND',
          skills: { react: 0.9 },
          timezoneOffsetHours: 1.0,
          weeklyAvailabilityHours: 20,
          collaborationStyle: 'HYBRID',
        },
        {
          userId: 'u-alpha',
          name: 'Alpha',
          primaryRole: 'FRONTEND',
          skills: { react: 0.9 },
          timezoneOffsetHours: 1.0,
          weeklyAvailabilityHours: 20,
          collaborationStyle: 'HYBRID',
        },
      ];

      const ranked = matchmaker.rankCandidatesForProject(tiedCandidates, projectSpec, 5);
      expect(ranked.length).toBe(2);
      expect(ranked[0].score).toBe(ranked[1].score);
      expect(ranked[0].candidate.userId).toBe('u-alpha');
      expect(ranked[1].candidate.userId).toBe('u-beta');
    });

    it('does not mutate candidate pool or candidate objects', () => {
      const originalSkills = { ...candidatePool[0].skills };
      const poolCopy = [...candidatePool];

      matchmaker.rankCandidatesForProject(candidatePool, projectSpec);

      expect(candidatePool.length).toBe(poolCopy.length);
      expect(candidatePool[0].skills).toEqual(originalSkills);
    });

    it('caches embeddings and invalidates safely when candidate skills change', () => {
      const candidate: CandidateProfile = {
        userId: 'u-test-cache',
        name: 'CacheTester',
        primaryRole: 'FRONTEND',
        skills: { react: 0.8 },
        timezoneOffsetHours: 0,
        weeklyAvailabilityHours: 20,
        collaborationStyle: 'HYBRID',
      };

      const vec1 = matchmaker.getCandidateEmbedding(candidate);
      const vec2 = matchmaker.getCandidateEmbedding(candidate);
      expect(vec1).toBe(vec2); // Cached instance

      // Mutate skills
      candidate.skills = { rust: 0.9 };
      const vec3 = matchmaker.getCandidateEmbedding(candidate);
      expect(vec3).not.toBe(vec1);
      expect(calculateCosineSimilarity(vec1, vec3)).toBeLessThan(0.5);
    });
  });
});
