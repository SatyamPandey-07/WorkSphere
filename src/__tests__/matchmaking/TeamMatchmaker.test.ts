import {
  TeamMatchmaker,
  CandidateProfile,
  ProjectSquadSpec,
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

  describe('Team Fitness Evaluation', () => {
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

  describe('Combinatorial Squad Search', () => {
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
});
