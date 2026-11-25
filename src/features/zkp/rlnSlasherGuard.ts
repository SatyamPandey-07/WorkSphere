/**
 * @fileoverview Rate-Limiting Nullifier (RLN) Epoch Quota Guard & Secret Recovery Slasher.
 *
 * ## Cryptographic & Algebraic Model
 *
 * Let $p$ be a large prime defining the finite prime field $\mathbb{F}_p = \mathbb{Z} / p\mathbb{Z}$
 * (defaulting to the BN254 scalar field prime `DEFAULT_RLN_PRIME`).
 *
 * 1. **Per-Epoch Linear Shamir Secret Sharing Polynomial:**
 *    $$f_e(x) = (a_0 + a_1 \cdot x) \bmod p$$
 *    where $a_0 \in \mathbb{F}_p$ is the user identity secret and $a_1 = H(a_0, e)$ is the epoch slope.
 *
 * 2. **Epoch Nullifier:**
 *    $$N = H(a_0, e)$$
 *    Binds emissions by the same identity within epoch $e$ without revealing $a_0$ for a single share.
 *
 * 3. **Quota Enforcement & Algebraic Slashing (Lagrange Interpolation at $x = 0$):**
 *    Given two distinct shares $(x_1, y_1)$ and $(x_2, y_2)$ with $x_1 \not\equiv x_2 \pmod p$:
 *    $$a_0 \equiv (y_1 x_2 - y_2 x_1)(x_2 - x_1)^{-1} \pmod p$$
 *    where $(x_2 - x_1)^{-1} \bmod p$ is computed via the Extended Euclidean Algorithm (`modInverse`).
 */
export type RlnShareStatus = 'accepted' | 'duplicate_share' | 'slashed';
export interface RlnShareInput { epoch: string | number; nullifier: string; x: bigint | number | string; y: bigint | number | string; }
export interface RlnGuardDecision { status: RlnShareStatus; allowed: boolean; recoveredSecret?: bigint; reason?: string; }
export interface RlnSlasherGuardOptions { fieldPrime?: bigint; }
/** Default 254-bit BN254 scalar field prime $p$ for exact modular arithmetic in $\mathbb{F}_p$. */
export const DEFAULT_RLN_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/** Normalizes an integer into its canonical representative in $[0, p - 1]$. */
export function modPositive(value: bigint, modulus: bigint): bigint { const m = value % modulus; return m >= 0n ? m : m + modulus; }
/** Computes $a^{-1} \bmod p$ via the Extended Euclidean Algorithm. */
export function modInverse(a: bigint, modulus: bigint): bigint { let oldR = modPositive(a, modulus); let r = modulus; let oldS = 1n; let s = 0n; while (r !== 0n) { const q = oldR / r; [oldR, r] = [r, oldR - q * r]; [oldS, s] = [s, oldS - q * s]; } if (oldR !== 1n) throw new Error('Modular inverse does not exist for non-coprime inputs'); return modPositive(oldS, modulus); }
/** Evaluates $f(x) = (a_0 + a_1 x) \bmod p$. */
export function evaluateLinearRlnShare(secretA0: bigint, slopeA1: bigint, x: bigint, modulus: bigint = DEFAULT_RLN_PRIME): bigint { return modPositive(modPositive(secretA0, modulus) + modPositive(modPositive(slopeA1, modulus) * modPositive(x, modulus), modulus), modulus); }
/** Reconstructs $a_0 = (y_1 x_2 - y_2 x_1)(x_2 - x_1)^{-1} \bmod p$ from two distinct shares. */
export function recoverSecretFromShares(share1: { x: bigint; y: bigint }, share2: { x: bigint; y: bigint }, modulus: bigint = DEFAULT_RLN_PRIME): bigint { const x1 = modPositive(share1.x, modulus); const y1 = modPositive(share1.y, modulus); const x2 = modPositive(share2.x, modulus); const y2 = modPositive(share2.y, modulus); const dx = modPositive(x2 - x1, modulus); if (dx === 0n) throw new Error('Cannot recover secret from identical x coordinates'); const num = modPositive(modPositive(y1 * x2, modulus) - modPositive(y2 * x1, modulus), modulus); return modPositive(num * modInverse(dx, modulus), modulus); }
interface StoredShare { x: bigint; y: bigint; }
/** Stateful per-epoch RLN quota guard and secret recovery slasher. */
export class RlnSlasherGuard { public readonly fieldPrime: bigint; private readonly epochShares = new Map<string, StoredShare[]>(); private readonly slashedSecrets = new Map<string, bigint>(); constructor(options: RlnSlasherGuardOptions = {}) { this.fieldPrime = options.fieldPrime ?? DEFAULT_RLN_PRIME; } private bucketKey(epoch: string | number, nullifier: string): string { return ${String(epoch)}::; } /** Validates a share against the (epoch, nullifier) quota and slashes on double-signaling. */ public submitShare(input: RlnShareInput): RlnGuardDecision { const key = this.bucketKey(input.epoch, input.nullifier); const x = modPositive(BigInt(input.x), this.fieldPrime); const y = modPositive(BigInt(input.y), this.fieldPrime); const existingSlashed = this.slashedSecrets.get(key); if (existingSlashed !== undefined) return { status: 'slashed', allowed: false, recoveredSecret: existingSlashed, reason: 'Nullifier already slashed in this epoch' }; const shares = this.epochShares.get(key) ?? []; for (const prev of shares) { if (prev.x === x && prev.y === y) return { status: 'duplicate_share', allowed: false, reason: 'Duplicate RLN share replayed in the same epoch' }; if (prev.x !== x) { const recoveredSecret = recoverSecretFromShares(prev, { x, y }, this.fieldPrime); shares.push({ x, y }); this.epochShares.set(key, shares); this.slashedSecrets.set(key, recoveredSecret); return { status: 'slashed', allowed: false, recoveredSecret, reason: 'Epoch quota exceeded: secret recovered from distinct shares' }; } } shares.push({ x, y }); this.epochShares.set(key, shares); return { status: 'accepted', allowed: true }; } /** Returns the recovered identity secret $a_0$ if (epoch, nullifier) has been slashed. */ public getSlashedSecret(epoch: string | number, nullifier: string): bigint | undefined { return this.slashedSecrets.get(this.bucketKey(epoch, nullifier)); } /** Clears all tracked epoch shares and slashed secret records. */ public clear(): void { this.epochShares.clear(); this.slashedSecrets.clear(); } }
export default RlnSlasherGuard;
