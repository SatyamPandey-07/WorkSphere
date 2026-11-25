/**
 * TeamMatchmaker.ts
 * Automated multi-skill collaborative project matchmaking engine.
 * Synthesizes high-velocity cross-functional engineering squads using multi-objective
 * fitness optimization across skill vector coverage, functional role diversity,
 * pairwise timezone overlap harmony, and collaboration cadence alignment.
 *
 * Enhanced with client-side 256-dimensional vector embedding cosine similarity ranking
 * and deterministic timezone overlap scoring (#8156).
 */

export const EMBEDDING_DIMENSION = 256;

export type FunctionalRole =
  | 'FRONTEND'
  | 'BACKEND'
  | 'FULLSTACK'
  | 'DEVOPS'
  | 'SYSTEMS_AI'
  | 'PRODUCT_DESIGN';

export type CollaborationStyle = 'SYNCHRONOUS' | 'ASYNCHRONOUS' | 'HYBRID';

export interface WorkingHoursWindow {
  startHour: number; // 0 to 24 (local wall-clock time)
  endHour: number;   // 0 to 24 (local wall-clock time)
}

export interface CandidateProfile {
  userId: string;
  name: string;
  primaryRole: FunctionalRole;
  skills: Record<string, number>; // Proficiency from 0.0 to 1.0 (or skill tags/weights)
  timezoneOffsetHours?: number | null; // e.g. -5 for EST, 0 for UTC, +1 for CET, +5.5 for IST. Undefined/null indicates unknown/unspecified.
  weeklyAvailabilityHours: number;
  collaborationStyle: CollaborationStyle;
  workingHours?: WorkingHoursWindow | null; // Optional explicit daily working hours (default 9-17 when specified)
  timezone?: string | null; // Optional IANA timezone identifier (e.g. 'America/New_York')
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
  projectTimezoneOffsetHours?: number | null; // Target project reference timezone offset (e.g. 0 for UTC, +1 for CET)
  projectTimezone?: string | null; // Optional IANA timezone identifier
  workingHours?: WorkingHoursWindow | null; // Optional target project working hours (default 9-17)
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

export interface MatchScoreBreakdown {
  overallScore: number;
  skillCosineSimilarity: number;
  timezoneOverlap: number;
  skillExplanation: string;
  timezoneExplanation: string;
  isTimezoneMissing?: boolean;
  isWorkingHoursMissing?: boolean;
}

export interface CandidateMatchResult {
  candidate: CandidateProfile;
  score: number;
  breakdown: MatchScoreBreakdown;
}

export interface TimezoneOverlapEvaluation {
  overlapScore: number; // Normalized overlap in [0.0, 1.0]
  isTimezoneMissing: boolean;
  isWorkingHoursMissing: boolean;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Skill Taxonomy & Deterministic Semantic Feature Space Mapping
// ---------------------------------------------------------------------------

interface TaxonomyCategory {
  id: number;
  name: string;
  baseDimension: number; // Base slot in 0..191 range (primary categories)
  skills: string[];
}

const TAXONOMY_CATEGORIES: TaxonomyCategory[] = [
  {
    id: 0,
    name: 'web_frontend',
    baseDimension: 0,
    skills: [
      'react', 'nextjs', 'vue', 'angular', 'svelte', 'typescript', 'javascript',
      'html', 'css', 'tailwind', 'sass', 'webpack', 'vite', 'redux', 'graphql'
    ]
  },
  {
    id: 1,
    name: 'backend_systems',
    baseDimension: 24,
    skills: [
      'nodejs', 'express', 'nestjs', 'golang', 'rust', 'java', 'csharp', 'dotnet',
      'python', 'django', 'fastapi', 'ruby', 'rails', 'php', 'scala', 'c++', 'grpc', 'kafka'
    ]
  },
  {
    id: 2,
    name: 'data_storage',
    baseDimension: 48,
    skills: [
      'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch',
      'dynamodb', 'sqlite', 'prisma', 'typeorm', 'cassandra', 'neo4j', 'snowflake'
    ]
  },
  {
    id: 3,
    name: 'cloud_devops',
    baseDimension: 72,
    skills: [
      'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'terraform',
      'ansible', 'helm', 'ci_cd', 'jenkins', 'github_actions', 'linux', 'bash'
    ]
  },
  {
    id: 4,
    name: 'ai_machine_learning',
    baseDimension: 96,
    skills: [
      'machine_learning', 'deep_learning', 'pytorch', 'tensorflow', 'scikit_learn',
      'llm', 'groq', 'openai', 'huggingface', 'rag', 'vector_search', 'nlp', 'computer_vision'
    ]
  },
  {
    id: 5,
    name: 'security_crypto',
    baseDimension: 120,
    skills: [
      'security', 'cryptography', 'solana', 'ethereum', 'web3', 'rust_crypto',
      'smart_contracts', 'zero_knowledge', 'zkp', 'oauth', 'jwt', 'pen_testing'
    ]
  },
  {
    id: 6,
    name: 'product_design',
    baseDimension: 144,
    skills: [
      'ui_ux', 'figma', 'product_design', 'wireframing', 'user_research',
      'design_systems', 'prototyping', 'interaction_design', 'accessibility', 'a11y'
    ]
  },
  {
    id: 7,
    name: 'qa_testing',
    baseDimension: 168,
    skills: [
      'jest', 'cypress', 'playwright', 'testing', 'unit_testing', 'integration_testing',
      'end_to_end', 'mocha', 'selenium', 'tdd', 'bdd'
    ]
  }
];

// Inverted lookup map for skill -> taxonomy category & offset
const SKILL_TAXONOMY_MAP = new Map<string, { categoryId: number; baseDim: number; subOffset: number }>();

for (const cat of TAXONOMY_CATEGORIES) {
  cat.skills.forEach((skillName, index) => {
    const normalized = skillName.toLowerCase().replace(/[-_\s]/g, '');
    SKILL_TAXONOMY_MAP.set(normalized, {
      categoryId: cat.id,
      baseDim: cat.baseDimension,
      subOffset: index % 20,
    });
  });
}

// Explicit complementary/substitutable skill relationships (cross-dimension resonance)
const COMPLEMENTARY_SKILLS: Record<string, string[]> = {
  react: ['nextjs', 'typescript', 'redux', 'tailwind', 'graphql'],
  vue: ['typescript', 'tailwind', 'vite'],
  angular: ['typescript', 'rxjs'],
  nodejs: ['express', 'nestjs', 'typescript', 'postgresql'],
  rust: ['solana', 'c++', 'grpc', 'webassembly'],
  python: ['fastapi', 'django', 'pytorch', 'scikit_learn'],
  docker: ['kubernetes', 'aws', 'ci_cd', 'terraform'],
  kubernetes: ['docker', 'helm', 'aws', 'gcp'],
  postgresql: ['prisma', 'typeorm', 'redis', 'nodejs'],
  solana: ['rust', 'web3', 'cryptography'],
  figma: ['ui_ux', 'design_systems', 'product_design', 'css'],
};

// 32-bit FNV-1a Hash for unknown skills to ensure deterministic mapping into dimension 192..255
function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * Normalizes an arbitrary skill name string by lowercasing, stripping extra whitespaces,
 * and normalizing delimiters like hyphens and underscores.
 */
export function normalizeSkillName(skill: string): string {
  if (!skill || typeof skill !== 'string') return '';
  return skill.toLowerCase().trim().replace(/[-_\s]+/g, '');
}

/**
 * Generates a deterministic, normalized 256-dimensional Float64Array embedding vector
 * for a skill set with associated proficiencies.
 *
 * Vector Layout (256 dimensions):
 * - Dims 0..191: Structured taxonomy categories (primary direct skill signals + complementary resonances)
 * - Dims 192..255: Generalized semantic feature hash projections for unknown or custom skills
 *
 * Vectors are strictly L2 normalized to unit Euclidean length (||v||₂ = 1.0).
 * If the input produces an all-zero vector, an all-zero 256-dimensional vector is safely returned.
 */
export function generateSkillEmbedding(
  skills: Record<string, number> | SkillRequirement[] | string[] | null | undefined
): Float64Array {
  const vector = new Float64Array(EMBEDDING_DIMENSION);
  if (!skills) return vector;

  // Normalize input into key-proficiency entries
  const skillEntries: [string, number][] = [];

  if (Array.isArray(skills)) {
    for (const item of skills) {
      if (!item) continue;
      if (typeof item === 'string') {
        const norm = normalizeSkillName(item);
        if (norm) skillEntries.push([norm, 1.0]);
      } else if (typeof item === 'object' && 'skill' in item) {
        const norm = normalizeSkillName((item as SkillRequirement).skill);
        const prof = typeof (item as SkillRequirement).minProficiency === 'number' && Number.isFinite((item as SkillRequirement).minProficiency)
          ? Math.max(0, Math.min(1, (item as SkillRequirement).minProficiency))
          : 1.0;
        if (norm) skillEntries.push([norm, prof]);
      }
    }
  } else if (typeof skills === 'object') {
    for (const rawKey of Object.keys(skills)) {
      const norm = normalizeSkillName(rawKey);
      const rawVal = skills[rawKey];
      const prof = typeof rawVal === 'number' && Number.isFinite(rawVal)
        ? Math.max(0, Math.min(1, rawVal))
        : 1.0;
      if (norm) skillEntries.push([norm, prof]);
    }
  }

  if (skillEntries.length === 0) return vector;

  // Process unique skill signals with duplicate deduplication (max proficiency)
  const deduplicated = new Map<string, number>();
  for (const [normSkill, prof] of skillEntries) {
    const existing = deduplicated.get(normSkill) ?? 0;
    if (prof > existing) {
      deduplicated.set(normSkill, prof);
    }
  }

  for (const [skill, proficiency] of deduplicated.entries()) {
    if (proficiency <= 0) continue;

    const taxonomy = SKILL_TAXONOMY_MAP.get(skill);
    if (taxonomy) {
      // 1. Direct Category Dimension
      const primaryDim = taxonomy.baseDim + taxonomy.subOffset;
      if (primaryDim < 192) {
        vector[primaryDim] += proficiency * 1.5;
      }

      // Category clustering anchor (reinforces intra-category affinity)
      const categoryAnchorDim = taxonomy.baseDim;
      vector[categoryAnchorDim] += proficiency * 0.5;

      // 2. Complementary skills cross-resonance
      const complements = COMPLEMENTARY_SKILLS[skill];
      if (complements) {
        for (const comp of complements) {
          const compTaxonomy = SKILL_TAXONOMY_MAP.get(comp);
          if (compTaxonomy) {
            const compDim = compTaxonomy.baseDim + compTaxonomy.subOffset;
            if (compDim < 192) {
              vector[compDim] += proficiency * 0.25;
            }
          }
        }
      }
    } else {
      // Unknown / custom skill: Project deterministically into dims 192..255 using FNV-1a dual-bucket hashing
      const h1 = fnv1a(skill);
      const h2 = fnv1a(skill + '_salt');
      const dim1 = 192 + (h1 % 64);
      const dim2 = 192 + (h2 % 64);

      vector[dim1] += proficiency * 1.0;
      vector[dim2] += proficiency * 0.5;
    }
  }

  // L2 Normalization: v / ||v||₂
  let sumSquares = 0;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    sumSquares += vector[i] * vector[i];
  }

  if (sumSquares > 0 && Number.isFinite(sumSquares)) {
    const invNorm = 1.0 / Math.sqrt(sumSquares);
    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      vector[i] *= invNorm;
    }
  }

  return vector;
}

/**
 * Calculates cosine similarity between two numeric vectors.
 *
 * cosine_similarity(u, p) = (u · p) / (||u||₂ × ||p||₂)
 *
 * Clamps result strictly within [-1.0, 1.0].
 * Returns 0.0 for zero vectors, mismatched dimensions, or non-finite inputs.
 */
export function calculateCosineSimilarity(
  vecA: Float64Array | number[] | null | undefined,
  vecB: Float64Array | number[] | null | undefined
): number {
  if (!vecA || !vecB) return 0.0;
  if (vecA.length !== vecB.length || vecA.length === 0) return 0.0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0.0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA <= 0 || normB <= 0 || !Number.isFinite(normA) || !Number.isFinite(normB)) {
    return 0.0;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator <= 0 || !Number.isFinite(denominator)) {
    return 0.0;
  }

  const similarity = dotProduct / denominator;
  if (!Number.isFinite(similarity)) return 0.0;

  return Math.max(-1.0, Math.min(1.0, similarity));
}

/**
 * Computes deterministic timezone overlap between a participant and a project window.
 *
 * Detailed Evaluation:
 * - If user timezone offset is missing (null/undefined/NaN), it cannot confirm any overlap:
 *   returns 0.0 with explicit isTimezoneMissing = true flag, avoiding artificial score inflation.
 * - Confirmed UTC timezone (offset === 0) is accurately evaluated against project window.
 * - Missing working-hour window uses deterministic standard default (09:00-17:00 local time)
 *   with an informative breakdown notation (isWorkingHoursMissing = true).
 *
 * Overlap = shared_available_duration / comparison_window_duration
 */
export function evaluateTimezoneOverlap(
  userOffsetHours: number | null | undefined,
  projectOffsetHours: number | null | undefined = 0,
  userWorkingHours?: WorkingHoursWindow | null,
  projectWorkingHours?: WorkingHoursWindow | null
): TimezoneOverlapEvaluation {
  const isTimezoneMissing = userOffsetHours === null || userOffsetHours === undefined || !Number.isFinite(userOffsetHours);
  const isWorkingHoursMissing = !userWorkingHours || typeof userWorkingHours !== 'object' ||
    typeof userWorkingHours.startHour !== 'number' || typeof userWorkingHours.endHour !== 'number';

  if (isTimezoneMissing) {
    return {
      overlapScore: 0.0,
      isTimezoneMissing: true,
      isWorkingHoursMissing,
      explanation: 'Timezone unconfirmed: Candidate has not provided timezone offset; timezone overlap defaulted to 0.0 to prevent unverified inflation.',
    };
  }

  const safeUserOffset = userOffsetHours as number;
  const safeProjOffset = typeof projectOffsetHours === 'number' && Number.isFinite(projectOffsetHours)
    ? projectOffsetHours
    : 0;

  const userHours = !isWorkingHoursMissing ? (userWorkingHours as WorkingHoursWindow) : { startHour: 9, endHour: 17 };
  const projHours = projectWorkingHours ?? { startHour: 9, endHour: 17 };

  // Analytical window overlap calculation in continuous UTC space
  const projDuration = projHours.endHour >= projHours.startHour
    ? projHours.endHour - projHours.startHour
    : (24 - projHours.startHour) + projHours.endHour;

  if (projDuration <= 0) {
    return {
      overlapScore: 0.0,
      isTimezoneMissing: false,
      isWorkingHoursMissing,
      explanation: 'Project working-hours duration is zero or invalid.',
    };
  }

  // Evaluate overlap: Project reference window on Day 1 is [ProjStartUTC, ProjEndUTC]
  // ProjLocal = UTC + ProjOffset -> UTC = ProjLocal - ProjOffset
  // For standard same-calendar cycle overlap, the user's working interval is UserLocal - UserOffset
  // The shift between user and project local working window midpoints is:
  // delta = (UserStart - UserOffset) - (ProjStart - ProjOffset)
  const offsetDiff = safeUserOffset - safeProjOffset;
  const absOffsetDiff = Math.abs(offsetDiff);

  let overlapHours = 0;

  if (userHours.startHour <= userHours.endHour && projHours.startHour <= projHours.endHour) {
    // Both are single daytime intervals
    if (absOffsetDiff < 24) {
      // Calculate intersection on the primary common calendar workday
      const projStartUTC = projHours.startHour - safeProjOffset;
      const projEndUTC = projHours.endHour - safeProjOffset;

      const userStartUTC = userHours.startHour - safeUserOffset;
      const userEndUTC = userHours.endHour - safeUserOffset;

      // Interval overlap max(0, min(projEnd, userEnd) - max(projStart, userStart))
      const intersection = Math.max(0, Math.min(projEndUTC, userEndUTC) - Math.max(projStartUTC, userStartUTC));
      overlapHours = Math.max(0, Math.min(projDuration, intersection));
    }
  } else {
    // Cross-midnight shifts: sample 15-minute intervals across 48h UTC timeline
    const steps = 96;
    const stepHours = 24 / steps;
    let projSteps = 0;
    let sharedSteps = 0;

    for (let s = 0; s < steps; s++) {
      const utc = s * stepHours;
      const projLocal = ((utc + safeProjOffset) % 24 + 24) % 24;
      const isProj = projHours.startHour <= projHours.endHour
        ? projLocal >= projHours.startHour && projLocal < projHours.endHour
        : projLocal >= projHours.startHour || projLocal < projHours.endHour;

      if (isProj) {
        projSteps++;
        if (absOffsetDiff < 24) {
          const userLocal = ((utc + safeUserOffset) % 24 + 24) % 24;
          const isUser = userHours.startHour <= userHours.endHour
            ? userLocal >= userHours.startHour && userLocal < userHours.endHour
            : userLocal >= userHours.startHour || userLocal < userHours.endHour;
          if (isUser && absOffsetDiff <= 16) {
            sharedSteps++;
          }
        }
      }
    }
    overlapHours = projSteps > 0 ? (sharedSteps / projSteps) * projDuration : 0;
  }

  const overlapRatio = Math.max(0.0, Math.min(1.0, parseFloat((overlapHours / projDuration).toFixed(4))));
  const tzPercent = Math.round(overlapRatio * 100);
  const sharedHoursEst = (overlapRatio * projDuration).toFixed(1);

  const hoursNote = isWorkingHoursMissing ? ' (assumed default 09:00-17:00)' : '';
  const explanation = overlapRatio >= 0.75
    ? `High working-hour synergy (${tzPercent}% overlap, ~${sharedHoursEst}h concurrent)${hoursNote}: Optimal synchronous collaboration window.`
    : overlapRatio >= 0.4
      ? `Moderate working-hour overlap (${tzPercent}% overlap, ~${sharedHoursEst}h concurrent)${hoursNote}: Feasible hybrid or handoff overlap.`
      : `Minimal or no working-hour overlap (${tzPercent}% overlap, ~${sharedHoursEst}h concurrent)${hoursNote}: Asynchronous collaboration required.`;

  return {
    overlapScore: overlapRatio,
    isTimezoneMissing: false,
    isWorkingHoursMissing,
    explanation,
  };
}

/**
 * Backward-compatible helper returning purely the numeric overlap score in [0.0, 1.0].
 */
export function calculateTimezoneOverlap(
  userOffsetHours: number | null | undefined,
  projectOffsetHours: number | null | undefined = 0,
  userWorkingHours?: WorkingHoursWindow | null,
  projectWorkingHours?: WorkingHoursWindow | null
): number {
  return evaluateTimezoneOverlap(userOffsetHours, projectOffsetHours, userWorkingHours, projectWorkingHours).overlapScore;
}

/**
 * Calculates the required weighted match score:
 * Score = 0.6 × cosine_similarity(user_vector, project_vector) + 0.4 × timezone_overlap(user_timezone, project_timezone)
 */
export function calculateWeightedMatchScore(
  cosineSim: number,
  tzOverlap: number,
  weightCosine: number = 0.6,
  weightTz: number = 0.4
): number {
  const safeSim = Number.isFinite(cosineSim) ? cosineSim : 0.0;
  const safeTz = Number.isFinite(tzOverlap) ? tzOverlap : 0.0;
  const score = weightCosine * safeSim + weightTz * safeTz;
  return parseFloat(score.toFixed(4));
}

// ---------------------------------------------------------------------------
// TeamMatchmaker Engine
// ---------------------------------------------------------------------------

export class TeamMatchmaker {
  private weightSkillCoverage = 0.35;
  private weightRoleDiversity = 0.25;
  private weightTimezoneHarmony = 0.25;
  private weightStyleAlignment = 0.15;

  private recommendationSkillWeight = 0.6;
  private recommendationTimezoneWeight = 0.4;

  // Embedding cache keyed by candidate userId and skill content signature
  private embeddingCache = new Map<string, { hash: string; vector: Float64Array }>();

  constructor(options?: {
    weightSkillCoverage?: number;
    weightRoleDiversity?: number;
    weightTimezoneHarmony?: number;
    weightStyleAlignment?: number;
    recommendationSkillWeight?: number;
    recommendationTimezoneWeight?: number;
  }) {
    if (options) {
      if (options.weightSkillCoverage !== undefined) this.weightSkillCoverage = options.weightSkillCoverage;
      if (options.weightRoleDiversity !== undefined) this.weightRoleDiversity = options.weightRoleDiversity;
      if (options.weightTimezoneHarmony !== undefined) this.weightTimezoneHarmony = options.weightTimezoneHarmony;
      if (options.weightStyleAlignment !== undefined) this.weightStyleAlignment = options.weightStyleAlignment;
      if (options.recommendationSkillWeight !== undefined) this.recommendationSkillWeight = options.recommendationSkillWeight;
      if (options.recommendationTimezoneWeight !== undefined) this.recommendationTimezoneWeight = options.recommendationTimezoneWeight;
    }
  }

  /**
   * Generates a 256-dimensional skill embedding vector for a candidate or project.
   */
  public generateSkillEmbedding(
    skills: Record<string, number> | SkillRequirement[] | string[] | null | undefined
  ): Float64Array {
    return generateSkillEmbedding(skills);
  }

  /**
   * Calculates cosine similarity between two 256-dimensional vectors.
   */
  public calculateCosineSimilarity(
    vecA: Float64Array | number[] | null | undefined,
    vecB: Float64Array | number[] | null | undefined
  ): number {
    return calculateCosineSimilarity(vecA, vecB);
  }

  /**
   * Calculates deterministic timezone overlap between user and project availability.
   */
  public calculateTimezoneOverlap(
    userOffsetHours: number | null | undefined,
    projectOffsetHours: number | null | undefined = 0,
    userWorkingHours?: WorkingHoursWindow | null,
    projectWorkingHours?: WorkingHoursWindow | null
  ): number {
    return calculateTimezoneOverlap(userOffsetHours, projectOffsetHours, userWorkingHours, projectWorkingHours);
  }

  /**
   * Evaluates timezone overlap with full diagnostic metadata.
   */
  public evaluateTimezoneOverlap(
    userOffsetHours: number | null | undefined,
    projectOffsetHours: number | null | undefined = 0,
    userWorkingHours?: WorkingHoursWindow | null,
    projectWorkingHours?: WorkingHoursWindow | null
  ): TimezoneOverlapEvaluation {
    return evaluateTimezoneOverlap(userOffsetHours, projectOffsetHours, userWorkingHours, projectWorkingHours);
  }

  /**
   * Gets or computes cached 256-dimensional embedding for a candidate profile.
   * Invalidates safely if skills signature changes.
   */
  public getCandidateEmbedding(candidate: CandidateProfile): Float64Array {
    const rawSkills = candidate.skills ?? {};
    const skillKeys = Object.keys(rawSkills).sort();
    const signature = skillKeys.map(k => `${k}:${rawSkills[k]}`).join('|');

    const cached = this.embeddingCache.get(candidate.userId);
    if (cached && cached.hash === signature) {
      return cached.vector;
    }

    const vector = generateSkillEmbedding(candidate.skills);
    this.embeddingCache.set(candidate.userId, { hash: signature, vector });
    return vector;
  }

  /**
   * Clears the candidate embedding cache.
   */
  public clearEmbeddingCache(): void {
    this.embeddingCache.clear();
  }

  /**
   * Ranks candidates for a project specification using 256-dimensional vector embedding
   * cosine similarity and timezone overlap scoring (#8156).
   *
   * Score = 0.6 × cosine_similarity(user_vector, project_vector) + 0.4 × timezone_overlap(user_timezone, project_timezone)
   *
   * Returns the top candidates (default top 5) sorted descending by overall match score.
   */
  public rankCandidatesForProject(
    candidates: CandidateProfile[],
    project: ProjectSquadSpec,
    topK: number = 5
  ): CandidateMatchResult[] {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return [];
    }

    // 1. Generate project requirement vector
    const projectVector = generateSkillEmbedding(project.requiredSkills);

    // Project reference timezone and working hours
    const projectTimezoneOffset = project.projectTimezoneOffsetHours ?? 0;
    const projectWorkingHours = project.workingHours ?? { startHour: 9, endHour: 17 };

    const scoredCandidates: CandidateMatchResult[] = [];

    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const candidate = candidates[cIdx];

      // Validate candidate record
      if (!candidate || typeof candidate !== 'object' || !candidate.userId) {
        continue;
      }

      // 2. Candidate skill embedding
      const candidateVector = this.getCandidateEmbedding(candidate);

      // 3. Skill cosine similarity
      const skillSim = calculateCosineSimilarity(candidateVector, projectVector);

      // 4. Timezone overlap evaluation
      const tzEval = evaluateTimezoneOverlap(
        candidate.timezoneOffsetHours,
        projectTimezoneOffset,
        candidate.workingHours,
        projectWorkingHours
      );

      // 5. Composite weighted match score
      const overallScore = calculateWeightedMatchScore(
        skillSim,
        tzEval.overlapScore,
        this.recommendationSkillWeight,
        this.recommendationTimezoneWeight
      );

      // 6. Transparent breakdown and human-readable explanations
      const skillPercent = Math.round(Math.max(0, skillSim) * 100);

      const skillExplanation = skillSim >= 0.8
        ? `High skill alignment (${skillPercent}%): Candidate profile strongly matches required project skill vector.`
        : skillSim >= 0.4
          ? `Moderate skill alignment (${skillPercent}%): Candidate covers some required domains or adjacent capabilities.`
          : skillSim > 0
            ? `Low skill alignment (${skillPercent}%): Candidate has minimal overlap with required project skills.`
            : `Orthogonal or non-matching skills (${skillPercent}%): No semantic overlap with project requirements.`;

      scoredCandidates.push({
        candidate,
        score: overallScore,
        breakdown: {
          overallScore,
          skillCosineSimilarity: parseFloat(skillSim.toFixed(4)),
          timezoneOverlap: parseFloat(tzEval.overlapScore.toFixed(4)),
          skillExplanation,
          timezoneExplanation: tzEval.explanation,
          isTimezoneMissing: tzEval.isTimezoneMissing,
          isWorkingHoursMissing: tzEval.isWorkingHoursMissing,
        },
      });
    }

    // 7. Deterministic sorting: Descending overallScore, secondary sort by stable candidate userId ASC
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.candidate.userId.localeCompare(b.candidate.userId);
    });

    // 8. Return top K (default 5)
    return scoredCandidates.slice(0, Math.max(0, topK));
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
        ...squad.map((member) => member.skills?.[req.skill.toLowerCase()] ?? 0)
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
    const tzOffsets = squad.map((m) => typeof m.timezoneOffsetHours === 'number' ? m.timezoneOffsetHours : 0);
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
