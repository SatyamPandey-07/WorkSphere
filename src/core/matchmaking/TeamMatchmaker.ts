/**
 * TeamMatchmaker.ts
 * Automated multi-skill collaborative project matchmaking engine.
 * Synthesizes high-velocity cross-functional engineering squads using multi-objective
 * fitness optimization across skill vector coverage, functional role diversity,
 * pairwise timezone overlap harmony, and collaboration cadence alignment.
 */

export type FunctionalRole =
  | 'FRONTEND'
  | 'BACKEND'
  | 'FULLSTACK'
  | 'DEVOPS'
  | 'SYSTEMS_AI'
  | 'PRODUCT_DESIGN';

export type CollaborationStyle = 'SYNCHRONOUS' | 'ASYNCHRONOUS' | 'HYBRID';

export interface CandidateProfile {
  userId: string;
  name: string;
  primaryRole: FunctionalRole;
  skills: Record<string, number>; // Proficiency from 0.0 to 1.0
  timezoneOffsetHours: number; // e.g. -5 for EST, +1 for CET, +5.5 for IST
  weeklyAvailabilityHours: number;
  collaborationStyle: CollaborationStyle;
}

export interface SkillRequirement {
  skill: string;
  minProficiency: number;
}

export interface ProjectSquadSpec {
  projectId: string;
  title: string;
  targetSize: number;
  requiredRoles: FunctionalRole[];
  requiredSkills: SkillRequirement[];
  maxTimezoneDeltaHours: number;
  minWeeklyHoursPerMember: number;
}

export interface TeamCompositionScore {
  overallFitnessScore: number; // 0 to 100
  skillCoverageScore: number; // 0 to 100
  roleDiversityScore: number; // 0 to 100
  timezoneHarmonyScore: number; // 0 to 100
  styleAlignmentScore: number; // 0 to 100
  missingRoles: FunctionalRole[];
  uncoveredSkills: string[];
  maxTimezoneSpanHours: number;
}

export interface MatchedSquadResult {
  squad: CandidateProfile[];
  score: TeamCompositionScore;
  strengths: string[];
  risks: string[];
}

export class TeamMatchmaker {
  private weightSkillCoverage = 0.35;
  private weightRoleDiversity = 0.25;
  private weightTimezoneHarmony = 0.25;
  private weightStyleAlignment = 0.15;

  constructor(options?: {
    weightSkillCoverage?: number;
    weightRoleDiversity?: number;
    weightTimezoneHarmony?: number;
    weightStyleAlignment?: number;
  }) {
    if (options) {
      if (options.weightSkillCoverage !== undefined) this.weightSkillCoverage = options.weightSkillCoverage;
      if (options.weightRoleDiversity !== undefined) this.weightRoleDiversity = options.weightRoleDiversity;
      if (options.weightTimezoneHarmony !== undefined) this.weightTimezoneHarmony = options.weightTimezoneHarmony;
      if (options.weightStyleAlignment !== undefined) this.weightStyleAlignment = options.weightStyleAlignment;
    }
  }

  /**
   * Evaluates the multi-objective fitness score of a candidate squad against project requirements
   */
  public evaluateTeamFitness(
    squad: CandidateProfile[],
    spec: ProjectSquadSpec
  ): TeamCompositionScore {
    if (squad.length === 0) {
      return {
        overallFitnessScore: 0,
        skillCoverageScore: 0,
        roleDiversityScore: 0,
        timezoneHarmonyScore: 0,
        styleAlignmentScore: 0,
        missingRoles: [...spec.requiredRoles],
        uncoveredSkills: spec.requiredSkills.map((s) => s.skill),
        maxTimezoneSpanHours: 0,
      };
    }

    // 1. Skill Coverage Evaluation
    const uncoveredSkills: string[] = [];
    let satisfiedSkillsCount = 0;

    for (const req of spec.requiredSkills) {
      const highestTeamSkill = Math.max(
        0,
        ...squad.map((member) => member.skills[req.skill.toLowerCase()] ?? 0)
      );

      if (highestTeamSkill >= req.minProficiency) {
        satisfiedSkillsCount++;
      } else {
        uncoveredSkills.push(req.skill);
      }
    }

    const skillCoverageScore =
      spec.requiredSkills.length > 0
        ? (satisfiedSkillsCount / spec.requiredSkills.length) * 100
        : 100;

    // 2. Role Diversity Evaluation
    const teamRoles = new Set(squad.map((m) => m.primaryRole));
    const missingRoles: FunctionalRole[] = [];

    for (const reqRole of spec.requiredRoles) {
      if (!teamRoles.has(reqRole)) {
        missingRoles.push(reqRole);
      }
    }

    const roleDiversityScore =
      spec.requiredRoles.length > 0
        ? ((spec.requiredRoles.length - missingRoles.length) / spec.requiredRoles.length) * 100
        : 100;

    // 3. Timezone Harmony Evaluation
    const tzOffsets = squad.map((m) => m.timezoneOffsetHours);
    const minTz = Math.min(...tzOffsets);
    const maxTz = Math.max(...tzOffsets);
    const maxTimezoneSpanHours = parseFloat((maxTz - minTz).toFixed(2));

    let timezoneHarmonyScore = 100;
    if (maxTimezoneSpanHours > spec.maxTimezoneDeltaHours) {
      const excess = maxTimezoneSpanHours - spec.maxTimezoneDeltaHours;
      timezoneHarmonyScore = Math.max(0, 100 - excess * 15.0); // 15 points penalty per excess hour
    }

    // 4. Style Alignment Evaluation
    const styles = squad.map((m) => m.collaborationStyle);
    const hasSync = styles.includes('SYNCHRONOUS');
    const hasAsync = styles.includes('ASYNCHRONOUS');

    let styleAlignmentScore = 100;
    if (hasSync && hasAsync) {
      // Clashing hard synchronous and hard asynchronous preferences
      const hybridCount = styles.filter((s) => s === 'HYBRID').length;
      styleAlignmentScore = 50 + hybridCount * 15;
    }

    // 5. Availability filter check
    const underHoursMember = squad.some((m) => m.weeklyAvailabilityHours < spec.minWeeklyHoursPerMember);
    const availabilityPenalty = underHoursMember ? 25 : 0;

    // Composite Weighted Score
    const rawCompositeScore =
      this.weightSkillCoverage * skillCoverageScore +
      this.weightRoleDiversity * roleDiversityScore +
      this.weightTimezoneHarmony * timezoneHarmonyScore +
      this.weightStyleAlignment * styleAlignmentScore -
      availabilityPenalty;

    const overallFitnessScore = Math.max(0, Math.min(100, Math.round(rawCompositeScore)));

    return {
      overallFitnessScore,
      skillCoverageScore: Math.round(skillCoverageScore),
      roleDiversityScore: Math.round(roleDiversityScore),
      timezoneHarmonyScore: Math.round(timezoneHarmonyScore),
      styleAlignmentScore: Math.round(styleAlignmentScore),
      missingRoles,
      uncoveredSkills,
      maxTimezoneSpanHours,
    };
  }

  /**
   * Explores combinations from candidate pool to synthesize top-ranked optimal squads
   */
  public findOptimalSquads(
    candidates: CandidateProfile[],
    spec: ProjectSquadSpec,
    topK: number = 3
  ): MatchedSquadResult[] {
    if (candidates.length < spec.targetSize) {
      return [];
    }

    // Generate combinations of size spec.targetSize
    const allCombos = this.getCombinations(candidates, spec.targetSize);
    const scoredSquads: MatchedSquadResult[] = [];

    for (const squad of allCombos) {
      const score = this.evaluateTeamFitness(squad, spec);

      const strengths: string[] = [];
      const risks: string[] = [];

      if (score.skillCoverageScore === 100) strengths.push('Complete coverage of all required skill domains.');
      if (score.roleDiversityScore === 100) strengths.push('Optimal cross-functional role distribution.');
      if (score.timezoneHarmonyScore >= 90) strengths.push(`Tight timezone alignment (${score.maxTimezoneSpanHours}h delta).`);

      if (score.uncoveredSkills.length > 0) risks.push(`Skill gap in: ${score.uncoveredSkills.join(', ')}.`);
      if (score.missingRoles.length > 0) risks.push(`Missing key role(s): ${score.missingRoles.join(', ')}.`);
      if (score.maxTimezoneSpanHours > spec.maxTimezoneDeltaHours) {
        risks.push(`Large timezone divergence (${score.maxTimezoneSpanHours}h exceeds target ${spec.maxTimezoneDeltaHours}h).`);
      }

      scoredSquads.push({
        squad,
        score,
        strengths,
        risks,
      });
    }

    // Sort descending by overall fitness score
    scoredSquads.sort((a, b) => b.score.overallFitnessScore - a.score.overallFitnessScore);

    return scoredSquads.slice(0, topK);
  }

  private getCombinations<T>(arr: T[], k: number): T[][] {
    const results: T[][] = [];

    function backtrack(start: number, current: T[]) {
      if (current.length === k) {
        results.push([...current]);
        return;
      }

      for (let i = start; i < arr.length; i++) {
        current.push(arr[i]);
        backtrack(i + 1, current);
        current.pop();
      }
    }

    backtrack(0, []);
    return results;
  }
}
