/**
 * WorkSphere WOCS Level Classifier
 *
 * Evaluates GitHub Issues and Pull Requests to assign the appropriate difficulty level:
 * - Level 1 (2 points): Beginner-friendly, docs, minor CSS/styling, typos, small bug fixes (<50 LOC)
 * - Level 2 (5 points): Moderate complexity, React components, hooks, API routes, unit tests (50-300 LOC)
 * - Level 3 (11 points): High complexity, WASM/DSP, AI Agents, WebSockets/PartyKit, WebRTC, Solana/Escrow, Prisma migrations
 */

export const LEVEL_1 = 'level 1';
export const LEVEL_2 = 'level 2';
export const LEVEL_3 = 'level 3';

// High complexity patterns (Level 3)
const LEVEL_3_FILE_PATTERNS = [
  /^src\/wasm\//i,
  /\.c$/i,
  /\.h$/i,
  /^src\/core\/ai\//i,
  /^src\/core\/ledger\//i,
  /^src\/core\/routing\//i,
  /^src\/lib\/agents\//i,
  /^src\/lib\/realtime\//i,
  /^party\//i,
  /^src\/lib\/audio\//i,
  /^src\/hooks\/useSpatialAudio/i,
  /^src\/hooks\/useAvionicsAudio/i,
  /^src\/lib\/solana\//i,
  /^prisma\/schema\.prisma/i,
  /^prisma\/migrations\//i,
  /^zkp\//i
];

const LEVEL_3_KEYWORDS = [
  'wasm', 'webassembly', 'dsp', 'audioworklet', 'audio worklet', 'fft',
  'decibel engine', 'solana', 'escrow', 'smart contract', 'multi-agent',
  'agent orchestration', 'vector embedding', 'pgvector', 'partykit',
  'webrtc', 'peer-to-peer', 'p2p mesh', 'zkp', 'zero knowledge',
  'proof of work', 'difficulty: hard', 'difficulty: high', 'level 3',
  'level3', 'architectural'
];

// Moderate complexity patterns (Level 2)
const LEVEL_2_FILE_PATTERNS = [
  /^src\/app\/api\//i,
  /^src\/components\//i,
  /^src\/hooks\//i,
  /^__tests__\//i,
  /\.test\.[tj]sx?$/i,
  /^playwright\//i,
  /^src\/lib\//i,
  /^src\/middleware\.ts/i
];

const LEVEL_2_KEYWORDS = [
  'api route', 'endpoint', 'component', 'modal', 'hook', 'state management',
  'unit test', 'integration test', 'jest', 'playwright', 'form validation',
  'zod schema', 'filter bar', 'dashboard', 'responsive layout', 'refactor',
  'difficulty: medium', 'level 2', 'level2'
];

// Beginner / Documentation patterns (Level 1)
const LEVEL_1_FILE_PATTERNS = [
  /\.md$/i,
  /^docs\//i,
  /^public\//i,
  /\.css$/i,
  /\.svg$/i,
  /\.png$/i,
  /\.ya?ml$/i,
  /LICENSE/i
];

const LEVEL_1_KEYWORDS = [
  'docs', 'documentation', 'readme', 'typo', 'grammar', 'spelling',
  'css', 'styling', 'color', 'spacing', 'padding', 'margin', 'icon',
  'aria-label', 'accessibility', 'alt text', 'comment', 'beginner',
  'good first issue', 'minor fix', 'difficulty: easy', 'difficulty: low',
  'level 1', 'level1'
];

/**
 * Classifies an Issue based on title, body, and labels.
 */
export function classifyIssue({ title = '', body = '', labels = [] } = {}) {
  const labelNames = labels.map(l => (typeof l === 'string' ? l : l.name).toLowerCase());
  
  // 1. Explicit level in existing labels
  if (labelNames.includes(LEVEL_3)) return LEVEL_3;
  if (labelNames.includes(LEVEL_2)) return LEVEL_2;
  if (labelNames.includes(LEVEL_1)) return LEVEL_1;

  const content = `${title}\n${body}`.toLowerCase();

  // 2. Check Level 3 keywords
  for (const kw of LEVEL_3_KEYWORDS) {
    if (content.includes(kw)) {
      return LEVEL_3;
    }
  }

  // 3. Check Level 2 keywords
  for (const kw of LEVEL_2_KEYWORDS) {
    if (content.includes(kw)) {
      return LEVEL_2;
    }
  }

  // 4. Check Level 1 keywords
  for (const kw of LEVEL_1_KEYWORDS) {
    if (content.includes(kw)) {
      return LEVEL_1;
    }
  }

  // Default fallback for generic issues
  return LEVEL_1;
}

/**
 * Classifies a Pull Request based on title, body, labels, changed files, and diff metrics.
 */
export function classifyPullRequest({
  title = '',
  body = '',
  labels = [],
  files = [],
  additions = 0,
  deletions = 0
} = {}) {
  const labelNames = labels.map(l => (typeof l === 'string' ? l : l.name).toLowerCase());

  // 1. Explicit level already applied to PR
  if (labelNames.includes(LEVEL_3)) return LEVEL_3;
  if (labelNames.includes(LEVEL_2)) return LEVEL_2;
  if (labelNames.includes(LEVEL_1)) return LEVEL_1;

  const fileList = files.map(f => (typeof f === 'string' ? f : f.filename || ''));
  const totalChanges = additions + deletions;
  const content = `${title}\n${body}`.toLowerCase();

  // 2. Pure documentation or styling changes -> Level 1
  if (fileList.length > 0 && fileList.every(f => LEVEL_1_FILE_PATTERNS.some(pat => pat.test(f)))) {
    return LEVEL_1;
  }

  // 3. Check for Level 3 files (WASM, Agent, Audio DSP, Realtime, Solana, DB Schema)
  const hasLevel3Files = fileList.some(f => LEVEL_3_FILE_PATTERNS.some(pat => pat.test(f)));
  const hasLevel3Keywords = LEVEL_3_KEYWORDS.some(kw => content.includes(kw));

  if (hasLevel3Files || (hasLevel3Keywords && totalChanges > 80)) {
    return LEVEL_3;
  }

  // Large substantial PR (> 350 LOC in core code)
  if (totalChanges >= 350 && fileList.some(f => f.startsWith('src/'))) {
    return LEVEL_3;
  }

  // 4. Check for Level 2 files (Components, API routes, Hooks, Tests)
  const hasLevel2Files = fileList.some(f => LEVEL_2_FILE_PATTERNS.some(pat => pat.test(f)));
  const hasLevel2Keywords = LEVEL_2_KEYWORDS.some(kw => content.includes(kw));

  if (hasLevel2Files || hasLevel2Keywords || totalChanges >= 50) {
    return LEVEL_2;
  }

  // 5. Small change (< 50 LOC) with no backend or complex components
  return LEVEL_1;
}

// ==========================================
// CLI & Direct Execution Support
// ==========================================
if (process.argv[1] && process.argv[1].endsWith('classify-level.mjs')) {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    console.log('Running test suite for Level Classifier...\n');

    const testCases = [
      {
        type: 'issue',
        input: { title: 'docs: update contribution guidelines in README', body: 'fix typo in setup' },
        expected: LEVEL_1
      },
      {
        type: 'issue',
        input: { title: 'feat: add booking confirmation modal component', body: 'create React modal with form validation' },
        expected: LEVEL_2
      },
      {
        type: 'issue',
        input: { title: 'feat(wasm): compile audio FFT filter in C with SIMD', body: 'implement WebAssembly DSP module' },
        expected: LEVEL_3
      },
      {
        type: 'pr',
        input: { title: 'docs: fix readme badges', files: ['README.md'], additions: 10, deletions: 2 },
        expected: LEVEL_1
      },
      {
        type: 'pr',
        input: { title: 'feat: add venue rating component', files: ['src/components/Rating.tsx'], additions: 120, deletions: 10 },
        expected: LEVEL_2
      },
      {
        type: 'pr',
        input: { title: 'feat: multi-agent memory decay in redis', files: ['src/core/ai/MemoryAgent.ts'], additions: 250, deletions: 40 },
        expected: LEVEL_3
      }
    ];

    let passed = 0;
    for (const tc of testCases) {
      const result = tc.type === 'issue' ? classifyIssue(tc.input) : classifyPullRequest(tc.input);
      const ok = result === tc.expected;
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${tc.type.toUpperCase()}: "${tc.input.title}" -> Result: ${result} (Expected: ${tc.expected})`);
      if (ok) passed++;
    }
    console.log(`\nTests passed: ${passed}/${testCases.length}`);
  } else {
    console.log('WorkSphere WOCS Level Classifier CLI');
    console.log('Usage:');
    console.log('  node scripts/classify-level.mjs --test');
  }
}

