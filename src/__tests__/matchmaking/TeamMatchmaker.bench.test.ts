/**
 * TeamMatchmaker.bench.test.ts
 * Performance benchmark suite for TeamMatchmaker vector embedding cosine similarity
 * and candidate ranking across 10, 100, 500, and 1000 candidate profiles.
 */

import { performance } from 'perf_hooks';
import * as os from 'os';
import {
  TeamMatchmaker,
  CandidateProfile,
  ProjectSquadSpec,
  FunctionalRole,
  generateSkillEmbedding,
  calculateCosineSimilarity,
  calculateTimezoneOverlap,
} from '../../core/matchmaking/TeamMatchmaker';

const ROLES: FunctionalRole[] = ['FRONTEND', 'BACKEND', 'FULLSTACK', 'DEVOPS', 'SYSTEMS_AI', 'PRODUCT_DESIGN'];
const SKILLS_POOL = [
  'react', 'nextjs', 'typescript', 'rust', 'kubernetes', 'docker', 'aws', 'python',
  'postgresql', 'redis', 'graphql', 'figma', 'solana', 'machine_learning', 'tailwind', 'golang'
];

function generateMockCandidates(count: number): CandidateProfile[] {
  const candidates: CandidateProfile[] = [];
  for (let i = 0; i < count; i++) {
    const role = ROLES[i % ROLES.length];
    const skillA = SKILLS_POOL[i % SKILLS_POOL.length];
    const skillB = SKILLS_POOL[(i * 3 + 1) % SKILLS_POOL.length];
    const skillC = SKILLS_POOL[(i * 7 + 2) % SKILLS_POOL.length];

    candidates.push({
      userId: `user-${String(i).padStart(4, '0')}`,
      name: `Candidate ${i}`,
      primaryRole: role,
      skills: {
        [skillA]: 0.7 + ((i * 17) % 30) / 100,
        [skillB]: 0.6 + ((i * 23) % 40) / 100,
        [skillC]: 0.5 + ((i * 31) % 50) / 100,
      },
      timezoneOffsetHours: ((i % 25) - 12) * 0.5,
      weeklyAvailabilityHours: 20 + (i % 21),
      collaborationStyle: i % 2 === 0 ? 'HYBRID' : 'SYNCHRONOUS',
    });
  }
  return candidates;
}

const mockProjectSpec: ProjectSquadSpec = {
  projectId: 'benchmark-project',
  title: 'High Velocity Distributed Squad',
  targetSize: 4,
  requiredRoles: ['FRONTEND', 'BACKEND', 'DEVOPS'],
  requiredSkills: [
    { skill: 'react', minProficiency: 0.8 },
    { skill: 'rust', minProficiency: 0.75 },
    { skill: 'kubernetes', minProficiency: 0.7 },
  ],
  maxTimezoneDeltaHours: 4.0,
  minWeeklyHoursPerMember: 20,
  projectTimezoneOffsetHours: 1.0,
};

describe('TeamMatchmaker Performance Benchmark', () => {
  let matchmaker: TeamMatchmaker;

  beforeAll(() => {
    matchmaker = new TeamMatchmaker();
    console.log('\n======================================================');
    console.log('   TeamMatchmaker Vector Matchmaking Benchmark Suite  ');
    console.log('======================================================');
    console.log(`Environment: Node.js ${process.version} on ${os.type()} ${os.release()} (${os.arch()})`);
    console.log(`Processor: ${os.cpus()[0]?.model} (${os.cpus().length} threads)`);
    console.log('------------------------------------------------------');
  });

  function measureBenchmark(
    candidates: CandidateProfile[],
    reps: number,
    cached: boolean
  ) {
    if (cached) {
      for (const c of candidates) {
        matchmaker.getCandidateEmbedding(c);
      }
    } else {
      matchmaker.clearEmbeddingCache();
    }

    // Warm-up run
    for (let w = 0; w < 10; w++) {
      matchmaker.rankCandidatesForProject(candidates, mockProjectSpec, 5);
    }

    const times: number[] = [];
    for (let r = 0; r < reps; r++) {
      if (!cached) {
        matchmaker.clearEmbeddingCache();
      }
      const start = performance.now();
      matchmaker.rankCandidatesForProject(candidates, mockProjectSpec, 5);
      const end = performance.now();
      times.push(end - start);
    }

    times.sort((a, b) => a - b);
    const min = times[0];
    const max = times[times.length - 1];
    const median = times[Math.floor(times.length / 2)];
    const sum = times.reduce((acc, t) => acc + t, 0);
    const mean = sum / times.length;
    const variance = times.reduce((acc, t) => acc + Math.pow(t - mean, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);

    return { min, max, median, mean, stdDev };
  }

  it('measures candidate ranking across 10, 100, 500, and 1000 candidates', () => {
    const sizes = [10, 100, 500, 1000];

    console.log('\n[Benchmark 1] Candidate Ranking with Cached Embeddings (Production Hot Path):');
    console.log('| Candidates | Median (ms) | Min (ms) | Max (ms) | StdDev (ms) | Median < 10ms | All < 10ms |');
    console.log('|-----------:|------------:|---------:|---------:|------------:|:-------------:|:----------:|');

    for (const size of sizes) {
      const candidates = generateMockCandidates(size);
      const reps = size <= 100 ? 50 : 20;
      const stats = measureBenchmark(candidates, reps, true);
      const medianPass = stats.median < 10.0 ? 'YES' : 'NO';
      const allPass = stats.max < 10.0 ? 'YES' : 'NO';
      console.log(
        `| ${String(size).padStart(10)} | ${stats.median.toFixed(3).padStart(11)} | ${stats.min.toFixed(3).padStart(8)} | ${stats.max.toFixed(3).padStart(8)} | ${stats.stdDev.toFixed(3).padStart(11)} | ${medianPass.padStart(13)} | ${allPass.padStart(10)} |`
      );

      expect(stats.median).toBeGreaterThan(0);
    }

    console.log('\n[Benchmark 2] Full From-Scratch Ranking (Embedding Gen + Cosine + Timezone + Sort):');
    console.log('| Candidates | Median (ms) | Min (ms) | Max (ms) | StdDev (ms) | Median < 10ms | All < 10ms |');
    console.log('|-----------:|------------:|---------:|---------:|------------:|:-------------:|:----------:|');

    for (const size of sizes) {
      const candidates = generateMockCandidates(size);
      const reps = size <= 100 ? 50 : 20;
      const stats = measureBenchmark(candidates, reps, false);
      const medianPass = stats.median < 10.0 ? 'YES' : 'NO';
      const allPass = stats.max < 10.0 ? 'YES' : 'NO';
      console.log(
        `| ${String(size).padStart(10)} | ${stats.median.toFixed(3).padStart(11)} | ${stats.min.toFixed(3).padStart(8)} | ${stats.max.toFixed(3).padStart(8)} | ${stats.stdDev.toFixed(3).padStart(11)} | ${medianPass.padStart(13)} | ${allPass.padStart(10)} |`
      );

      expect(stats.median).toBeGreaterThan(0);
    }
  });

  it('measures component micro-benchmarks (10,000 iterations)', () => {
    const dummyA = generateSkillEmbedding({ react: 0.9, typescript: 0.8, css: 0.9 });
    const dummyB = generateSkillEmbedding({ rust: 0.85, postgresql: 0.8, grpc: 0.75 });

    // Cosine similarity
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      calculateCosineSimilarity(dummyA, dummyB);
    }
    const t1 = performance.now();
    const cosineTotal = t1 - t0;
    const cosinePerOp = (cosineTotal / 10000) * 1000; // microseconds

    // Timezone overlap
    const t2 = performance.now();
    for (let i = 0; i < 10000; i++) {
      calculateTimezoneOverlap(1.0, -4.0);
    }
    const t3 = performance.now();
    const tzTotal = t3 - t2;
    const tzPerOp = (tzTotal / 10000) * 1000;

    // Skill embedding generation
    const t4 = performance.now();
    for (let i = 0; i < 10000; i++) {
      generateSkillEmbedding({ react: 0.9, typescript: 0.8, css: 0.9 });
    }
    const t5 = performance.now();
    const embedTotal = t5 - t4;
    const embedPerOp = (embedTotal / 10000) * 1000;

    console.log('\n[Component Micro-benchmarks (10,000 ops)]:');
    console.log(`- Cosine Similarity:  ${cosineTotal.toFixed(2)} ms total (${cosinePerOp.toFixed(3)} µs/op)`);
    console.log(`- Timezone Overlap:   ${tzTotal.toFixed(2)} ms total (${tzPerOp.toFixed(3)} µs/op)`);
    console.log(`- Skill Embedding:    ${embedTotal.toFixed(2)} ms total (${embedPerOp.toFixed(3)} µs/op)`);

    expect(cosineTotal).toBeGreaterThan(0);
    expect(tzTotal).toBeGreaterThan(0);
    expect(embedTotal).toBeGreaterThan(0);
  });
});
