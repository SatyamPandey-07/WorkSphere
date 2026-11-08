/**
 * Poseidon hash over the BN254 scalar field (alpha = 5, 8 full rounds).
 *
 * This is the exact permutation computed by circomlib's `Poseidon(n)` template
 * (circomlib/circuits/poseidon.circom), which is what
 * circuits/premium_membership.circom uses to bind the public commitment to the
 * private identity token. TypeScript and the circuit MUST agree bit-for-bit, or
 * every legitimate proof is rejected.
 *
 * Round constants and the MDS matrix are not hard-coded. They are derived from
 * the Grain LFSR exactly as in the reference Poseidon parameter script (the
 * same one circomlib's constants come from) and are computed once, lazily.
 * Correctness is pinned by the published circomlib test vectors in
 * src/__tests__/lib/zkp.test.ts:
 *   Poseidon([1])    = 18586133768512220936620570745912940619677854269274689475585506675881198879027
 *   Poseidon([1, 2]) = 7853200120776062878684798364095072458815029376092732009249414926327459813530
 */

/** BN254 (alt_bn128) scalar field modulus. */
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const P = BN254_SCALAR_FIELD;
const FIELD_BITS = 254;
const FULL_ROUNDS = 8;

/** Partial rounds per state width t = inputs + 1 (circomlib N_ROUNDS_P). */
const PARTIAL_ROUNDS_BY_WIDTH: Record<number, number> = {
  2: 56,
  3: 57,
  4: 56,
};

interface PoseidonParams {
  t: number;
  partialRounds: number;
  roundConstants: bigint[];
  mds: bigint[][];
}

const paramsCache = new Map<number, PoseidonParams>();

function bitsOf(value: number, width: number): number[] {
  return value
    .toString(2)
    .padStart(width, "0")
    .split("")
    .map((c) => (c === "1" ? 1 : 0));
}

/** Grain LFSR bit generator from the Poseidon reference implementation. */
function createGrain(t: number, partialRounds: number): () => number {
  const state = new Uint8Array(80);
  const init = [
    ...bitsOf(1, 2), // field type: prime field
    ...bitsOf(0, 4), // s-box: x^alpha
    ...bitsOf(FIELD_BITS, 12),
    ...bitsOf(t, 12),
    ...bitsOf(FULL_ROUNDS, 10),
    ...bitsOf(partialRounds, 10),
    ...new Array<number>(30).fill(1),
  ];
  state.set(init);

  let head = 0;
  const step = (): number => {
    const bit =
      state[(head + 62) % 80] ^
      state[(head + 51) % 80] ^
      state[(head + 38) % 80] ^
      state[(head + 23) % 80] ^
      state[(head + 13) % 80] ^
      state[head];
    state[head] = bit;
    head = (head + 1) % 80;
    return bit;
  };

  for (let i = 0; i < 160; i++) step(); // warm-up

  return () => {
    let selector = step();
    while (selector === 0) {
      step(); // discard the paired value bit
      selector = step();
    }
    return step();
  };
}

function randomFieldBits(nextBit: () => number): bigint {
  let v = 0n;
  for (let i = 0; i < FIELD_BITS; i++) v = (v << 1n) | BigInt(nextBit());
  return v;
}

function modInverse(a: bigint): bigint {
  // Fermat: a^(P-2) mod P (P is prime).
  let result = 1n;
  let base = ((a % P) + P) % P;
  let exp = P - 2n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % P;
    base = (base * base) % P;
    exp >>= 1n;
  }
  return result;
}

function getParams(t: number): PoseidonParams {
  const cached = paramsCache.get(t);
  if (cached) return cached;

  const partialRounds = PARTIAL_ROUNDS_BY_WIDTH[t];
  if (partialRounds === undefined) {
    throw new Error(`Poseidon: unsupported state width t=${t}`);
  }

  const nextBit = createGrain(t, partialRounds);

  // Round constants use rejection sampling (value must be < P).
  const roundConstants: bigint[] = [];
  for (let i = 0; i < (FULL_ROUNDS + partialRounds) * t; i++) {
    let v = randomFieldBits(nextBit);
    while (v >= P) v = randomFieldBits(nextBit);
    roundConstants.push(v);
  }

  // Cauchy MDS matrix: M[i][j] = 1 / (x_i + y_j). Unlike the round constants,
  // the reference script reduces x/y modulo P rather than rejection sampling.
  let xs: bigint[] = [];
  let ys: bigint[] = [];
  for (;;) {
    const values: bigint[] = [];
    for (let i = 0; i < 2 * t; i++) values.push(randomFieldBits(nextBit) % P);
    xs = values.slice(0, t);
    ys = values.slice(t);
    const distinct = new Set(values).size === 2 * t;
    const noZeroSum = xs.every((x) => ys.every((y) => (x + y) % P !== 0n));
    if (distinct && noZeroSum) break;
  }
  const mds = xs.map((x) => ys.map((y) => modInverse(x + y)));

  const params: PoseidonParams = { t, partialRounds, roundConstants, mds };
  paramsCache.set(t, params);
  return params;
}

function sbox(x: bigint): bigint {
  const x2 = (x * x) % P;
  const x4 = (x2 * x2) % P;
  return (x4 * x) % P;
}

/**
 * Poseidon hash of 1..3 field elements. Inputs are reduced into [0, P), which
 * mirrors how a circom signal treats negative or oversized witness values.
 */
export function poseidonHash(inputs: bigint[]): bigint {
  if (inputs.length < 1) throw new Error("Poseidon: at least one input needed");

  const { t, partialRounds, roundConstants, mds } = getParams(inputs.length + 1);

  let state = [0n, ...inputs.map((x) => ((x % P) + P) % P)];
  const totalRounds = FULL_ROUNDS + partialRounds;

  for (let r = 0; r < totalRounds; r++) {
    state = state.map((x, i) => (x + roundConstants[r * t + i]) % P);

    const isFull =
      r < FULL_ROUNDS / 2 || r >= FULL_ROUNDS / 2 + partialRounds;
    state = isFull
      ? state.map(sbox)
      : [sbox(state[0]), ...state.slice(1)];

    state = mds.map((row) =>
      row.reduce((acc, m, j) => (acc + m * state[j]) % P, 0n),
    );
  }

  return state[0];
}
