/**
 * @fileoverview Rate-Limiting Nullifier (RLN) Epoch Quota Guard & Secret Recovery Slasher.
 *
 * ## Cryptographic & Algebraic Model
 *
 * Let $p$ be a large prime defining the finite prime field $\mathbb{F}_p = \mathbb{Z} / p\mathbb{Z}$
 * (defaulting to the BN254 scalar field prime `DEFAULT_RLN_PRIME`).
 *
 * 1. **Per-Epoch Linear Shamir Secret Sharing Polynomial:**
 *    For a given epoch $e$ and user identity secret $a_0 \in \mathbb{F}_p$, the user derives a
 *    degree-1 polynomial over $\mathbb{F}_p$:
 *    $$f_e(x) = (a_0 + a_1 \cdot x) \bmod p$$
 *    where $a_1 = H(a_0, e) \in \mathbb{F}_p$ is an epoch-specific random slope.
 *
 * 2. **Epoch Nullifier:**
 *    Each message emitted in epoch $e$ carries a deterministic epoch nullifier:
 *    $$N = H(a_0, e)$$
 *    This links multiple emissions by the same identity within epoch $e$ without revealing $a_0$
 *    as long as the per-epoch quota ($k = 1$) is respected.
 *
 * 3. **Quota Enforcement & Algebraic Slashing (Lagrange Interpolation at $x = 0$):**
 *    - **First valid share $(x_1, y_1)$:** Stored under bucket `(epoch, nullifier)`. Since two
 *      points are required to uniquely determine a line in $\mathbb{F}_p^2$, $a_0$ remains
 *      information-theoretically hidden.
 *    - **Duplicate share $(x_1, y_1)$:** Rejected with `'duplicate_share'` without leaking $a_0$.
 *    - **Second distinct share $(x_2, y_2)$ with $x_1 \not\equiv x_2 \pmod p$:**
 *      Two distinct points on $f_e(x)$ uniquely determine the $y$-intercept $a_0 = f_e(0)$ via
 *      Lagrange interpolation over $\mathbb{F}_p$:
 *      $$a_0 \equiv \frac{y_1 x_2 - y_2 x_1}{x_2 - x_1} \equiv (y_1 x_2 - y_2 x_1)(x_2 - x_1)^{-1} \pmod p$$
 *      where $(x_2 - x_1)^{-1} \bmod p$ is computed exactly via the Extended Euclidean Algorithm
 *      (`modInverse`) using arbitrary-precision `bigint` arithmetic.
 *
 * @module features/zkp/rlnSlasherGuard
 */

/**
 * Outcome status returned when evaluating an RLN share submission within an epoch.
 *
 * - `'accepted'`: First valid share observed for `(epoch, nullifier)`; quota respected.
 * - `'duplicate_share'`: Exact `(x, y)` coordinate pair was already submitted in this epoch.
 * - `'slashed'`: A second distinct `x` coordinate was submitted in the same epoch, allowing
 *   algebraic reconstruction of the identity secret `a0`.
 */
export type RlnShareStatus = 'accepted' | 'duplicate_share' | 'slashed';

/**
 * Input payload representing a single RLN-authenticated action within an epoch.
 */
export interface RlnShareInput {
  /** Epoch identifier (e.g., block window, slot index, or ISO date bucket). */
  epoch: string | number;
  /** Deterministic epoch nullifier $N = H(a_0, e)$ binding shares to the same sender in `epoch`. */
  nullifier: string;
  /** Evaluation point $x_i \in \mathbb{F}_p$ (e.g., hash of message payload and timestamp). */
  x: bigint | number | string;
  /** Polynomial evaluation $y_i = f_e(x_i) = (a_0 + a_1 x_i) \bmod p$. */
  y: bigint | number | string;
}

/**
 * Decision object produced by {@link RlnSlasherGuard.submitShare}.
 */
export interface RlnGuardDecision {
  /** Classification of the share submission. */
  status: RlnShareStatus;
  /** `true` if the action is within the epoch quota and permitted to proceed; `false` otherwise. */
  allowed: boolean;
  /**
   * Reconstructed identity secret $a_0 \in \mathbb{F}_p$, populated strictly when
   * `status === 'slashed'`. Never populated for `'accepted'` or `'duplicate_share'`.
   */
  recoveredSecret?: bigint;
  /** Human-readable explanation when `allowed` is `false`. */
  reason?: string;
}

/**
 * Configuration options for {@link RlnSlasherGuard}.
 */
export interface RlnSlasherGuardOptions {
  /**
   * Prime modulus $p$ defining the finite field $\mathbb{F}_p$.
   * Defaults to {@link DEFAULT_RLN_PRIME} (BN254 scalar field prime).
   */
  fieldPrime?: bigint;
}

/**
 * Default 254-bit prime modulus $p$ (BN254 / alt_bn128 scalar field order) used for
 * exact modular arithmetic in $\mathbb{F}_p$.
 */
export const DEFAULT_RLN_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Normalizes an integer into its canonical representative in $[0, p - 1]$.
 *
 * JavaScript's `%` operator preserves the sign of the dividend; this helper guarantees a
 * non-negative residue $r \equiv \text{value} \pmod{\text{modulus}}$ with $0 \le r < \text{modulus}$.
 *
 * @param value - Arbitrary signed `bigint` value.
 * @param modulus - Positive prime modulus $p$.
 * @returns Canonical residue in $[0, \text{modulus} - 1]$.
 */
export function modPositive(value: bigint, modulus: bigint): bigint {
  const m = value % modulus;
  return m >= 0n ? m : m + modulus;
}

/**
 * Computes the modular multiplicative inverse $a^{-1} \bmod p$ using the Extended Euclidean Algorithm.
 *
 * Finds Bézout coefficients $(s, t)$ such that $a \cdot s + p \cdot t = \gcd(a, p) = 1$,
 * returning $s \bmod p \in [0, p - 1]$.
 *
 * @param a - Field element to invert ($a \not\equiv 0 \pmod p$).
 * @param modulus - Prime modulus $p$.
 * @returns Unique $a^{-1} \in [0, p - 1]$ satisfying $(a \cdot a^{-1}) \bmod p = 1$.
 * @throws {Error} If $\gcd(a \bmod p, p) \neq 1$ (e.g., when $a \equiv 0 \pmod p$).
 */
export function modInverse(a: bigint, modulus: bigint): bigint {
  let oldR = modPositive(a, modulus);
  let r = modulus;
  let oldS = 1n;
  let s = 0n;

  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }

  if (oldR !== 1n) {
    throw new Error('Modular inverse does not exist for non-coprime inputs');
  }

  return modPositive(oldS, modulus);
}

/**
 * Evaluates a degree-1 Shamir secret sharing polynomial $f(x) = (a_0 + a_1 x) \bmod p$.
 *
 * @param secretA0 - Constant term $a_0$ (the user's secret identity key).
 * @param slopeA1 - Linear coefficient $a_1$ (epoch-specific random slope).
 * @param x - Evaluation coordinate $x \in \mathbb{F}_p$.
 * @param modulus - Prime field modulus $p$ (defaults to {@link DEFAULT_RLN_PRIME}).
 * @returns Field element $y = (a_0 + a_1 x) \bmod p$.
 */
export function evaluateLinearRlnShare(
  secretA0: bigint,
  slopeA1: bigint,
  x: bigint,
  modulus: bigint = DEFAULT_RLN_PRIME
): bigint {
  const a0 = modPositive(secretA0, modulus);
  const a1 = modPositive(slopeA1, modulus);
  const xMod = modPositive(x, modulus);
  return modPositive(a0 + modPositive(a1 * xMod, modulus), modulus);
}

/**
 * Reconstructs the secret constant term $a_0 = f(0)$ from two distinct shares
 * $(x_1, y_1)$ and $(x_2, y_2)$ on the same degree-1 polynomial over $\mathbb{F}_p$.
 *
 * Uses Lagrange interpolation at $x = 0$:
 * $$a_0 = \left(y_1 \cdot \frac{0 - x_2}{x_1 - x_2} + y_2 \cdot \frac{0 - x_1}{x_2 - x_1}\right) \bmod p
 *       = (y_1 x_2 - y_2 x_1)(x_2 - x_1)^{-1} \bmod p$$
 *
 * @param share1 - First share $(x_1, y_1)$.
 * @param share2 - Second share $(x_2, y_2)$ with $x_1 \not\equiv x_2 \pmod p$.
 * @param modulus - Prime field modulus $p$ (defaults to {@link DEFAULT_RLN_PRIME}).
 * @returns Recovered secret $a_0 \in [0, p - 1]$.
 * @throws {Error} If $x_1 \equiv x_2 \pmod p$, as the two points do not uniquely define a line.
 */
export function recoverSecretFromShares(
  share1: { x: bigint; y: bigint },
  share2: { x: bigint; y: bigint },
  modulus: bigint = DEFAULT_RLN_PRIME
): bigint {
  const x1 = modPositive(share1.x, modulus);
  const y1 = modPositive(share1.y, modulus);
  const x2 = modPositive(share2.x, modulus);
  const y2 = modPositive(share2.y, modulus);

  const dx = modPositive(x2 - x1, modulus);
  if (dx === 0n) {
    throw new Error('Cannot recover secret from identical x coordinates');
  }

  const num = modPositive(
    modPositive(y1 * x2, modulus) - modPositive(y2 * x1, modulus),
    modulus
  );
  const invDx = modInverse(dx, modulus);
  return modPositive(num * invDx, modulus);
}

/** Internal representation of a canonicalized share stored per `(epoch, nullifier)` bucket. */
interface StoredShare {
  x: bigint;
  y: bigint;
}

/**
 * Stateful per-epoch Rate-Limiting Nullifier (RLN) quota guard and slasher.
 *
 * Enforces a strict 1-message-per-epoch quota per `(epoch, nullifier)` pair:
 * - Preserves anonymity when a user submits at most one valid share per epoch.
 * - Rejects exact duplicate share replays (`'duplicate_share'`).
 * - Immediately reconstructs and exposes $a_0$ (`'slashed'`) if a second share with a
 *   distinct $x$-coordinate is observed within the same epoch.
 */
export class RlnSlasherGuard {
  /** Prime field modulus $p$ used for all modular operations in this guard instance. */
  public readonly fieldPrime: bigint;
  private readonly epochShares = new Map<string, StoredShare[]>();
  private readonly slashedSecrets = new Map<string, bigint>();

  /**
   * Creates a new {@link RlnSlasherGuard} instance.
   *
   * @param options - Optional field configuration.
   */
  constructor(options: RlnSlasherGuardOptions = {}) {
    this.fieldPrime = options.fieldPrime ?? DEFAULT_RLN_PRIME;
  }

  /**
   * Builds a composite lookup key isolating nullifier state per epoch.
   */
  private bucketKey(epoch: string | number, nullifier: string): string {
    return `${String(epoch)}::${nullifier}`;
  }

  /**
   * Validates a share against the `(epoch, nullifier)` quota and slashes on double-signaling.
   *
   * @param input - Share coordinates `(x, y)` bound to `epoch` and `nullifier`.
   * @returns {@link RlnGuardDecision} indicating acceptance, duplicate rejection, or slashing with `recoveredSecret`.
   */
  public submitShare(input: RlnShareInput): RlnGuardDecision {
    const key = this.bucketKey(input.epoch, input.nullifier);
    const x = modPositive(BigInt(input.x), this.fieldPrime);
    const y = modPositive(BigInt(input.y), this.fieldPrime);

    const existingSlashed = this.slashedSecrets.get(key);
    if (existingSlashed !== undefined) {
      return {
        status: 'slashed',
        allowed: false,
        recoveredSecret: existingSlashed,
        reason: 'Nullifier already slashed in this epoch',
      };
    }

    const shares = this.epochShares.get(key) ?? [];

    for (const prev of shares) {
      if (prev.x === x && prev.y === y) {
        return {
          status: 'duplicate_share',
          allowed: false,
          reason: 'Duplicate RLN share replayed in the same epoch',
        };
      }
      if (prev.x !== x) {
        const recoveredSecret = recoverSecretFromShares(
          prev,
          { x, y },
          this.fieldPrime
        );
        shares.push({ x, y });
        this.epochShares.set(key, shares);
        this.slashedSecrets.set(key, recoveredSecret);
        return {
          status: 'slashed',
          allowed: false,
          recoveredSecret,
          reason: 'Epoch quota exceeded: secret recovered from distinct shares',
        };
      }
    }

    shares.push({ x, y });
    this.epochShares.set(key, shares);
    return {
      status: 'accepted',
      allowed: true,
    };
  }

  /**
   * Retrieves the recovered identity secret $a_0$ if `(epoch, nullifier)` has been slashed.
   *
   * @param epoch - Epoch identifier.
   * @param nullifier - Epoch nullifier string.
   * @returns Reconstructed secret $a_0$, or `undefined` if not slashed.
   */
  public getSlashedSecret(
    epoch: string | number,
    nullifier: string
  ): bigint | undefined {
    return this.slashedSecrets.get(this.bucketKey(epoch, nullifier));
  }

  /**
   * Clears all tracked epoch shares and slashed secret records.
   */
  public clear(): void {
    this.epochShares.clear();
    this.slashedSecrets.clear();
  }
}

export default RlnSlasherGuard;