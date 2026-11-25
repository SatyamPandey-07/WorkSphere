import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Verifiable Blind Token Batch Issuer & VOPRF Privacy Pass Prover.
 *
 * Implements RFC 9497 / Privacy Pass-style Batched Verifiable Oblivious Pseudorandom Function
 * (VOPRF) anonymous tokens over a safe-prime quadratic-residue subgroup:
 *  1. Client samples N random nonces t_i, hashes each to subgroup point T_i = H2G(t_i),
 *     blinds each with fresh secret r_i -> M_i = T_i^{r_i}, and sends [M_0..M_{N-1}].
 *  2. Issuer holds secret key k and public key Y = g^k, evaluates Z_i = M_i^k for all i,
 *     and emits ONE constant-size Fiat-Shamir batched Chaum-Pedersen DLEQ proof certifying
 *     log_g(Y) == log_{M_i}(Z_i) across ALL N tokens simultaneously!
 *  3. Client verifies the single batch DLEQ proof, unblinds N_i = Z_i^{r_i^{-1}} = T_i^k,
 *     and later redeems (t_i, redemptionTag_i = HMAC(N_i, requestContext)) unlinkably —
 *     issuer verifies T_i^k and rejects double-spend via a spent-nonce registry!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  const v = modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
  return v === 0n ? 1n : v;
}

export interface VOPRFIssuerKeys {
  issuerId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface ClientBlindedToken {
  nonceHex: string;
  basePointT: bigint;
  blindingR: bigint;
  blindedM: bigint;
}

export interface BatchedVOPRFResponse {
  issuerId: string;
  issuerPublicKey: bigint;
  blindedInputs: bigint[];
  evaluatedOutputs: bigint[];
  foldingSeed: bigint;
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  responseK: bigint;
}

export interface UnblindedPrivacyToken {
  issuerId: string;
  nonceHex: string;
  unblindedPointN: bigint; // T^k
}

export interface TokenRedemptionTicket {
  issuerId: string;
  nonceHex: string;
  requestBinding: string;
  redemptionMac: string;
}

export class VerifiableBlindTokenBatchProver {
  private spentNonces = new Set<string>();

  public createIssuer(issuerId: string, secret?: bigint): VOPRFIssuerKeys {
    const secretKey = secret !== undefined ? modScalar(secret) : randomScalar();
    if (secretKey === 0n) throw new Error('Issuer secret key must be non-zero');
    return {
      issuerId,
      secretKey,
      publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P),
    };
  }

  public hashNonceToSubgroup(nonceHex: string): bigint {
    const hex = sha256Hex('VOPRF-H2G-V1', nonceHex);
    const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
    const qr = (raw * raw) % SAFE_PRIME_P;
    return qr === 1n ? BASE_G : qr;
  }

  public clientBlindBatch(count: number): ClientBlindedToken[] {
    if (count < 1 || count > 256) throw new RangeError('Batch count must be in [1, 256]');
    return Array.from({ length: count }, () => {
      const nonceHex = randomBytes(24).toString('hex');
      const basePointT = this.hashNonceToSubgroup(nonceHex);
      const blindingR = randomScalar();
      const blindedM = modPow(basePointT, blindingR, SAFE_PRIME_P);
      return { nonceHex, basePointT, blindingR, blindedM };
    });
  }

  private foldElements(inputs: bigint[], outputs: bigint[], seed: bigint): { compositeM: bigint; compositeZ: bigint } {
    let compositeM = 1n;
    let compositeZ = 1n;
    let w = 1n;
    for (let i = 0; i < inputs.length; i++) {
      compositeM = (compositeM * modPow(inputs[i], w, SAFE_PRIME_P)) % SAFE_PRIME_P;
      compositeZ = (compositeZ * modPow(outputs[i], w, SAFE_PRIME_P)) % SAFE_PRIME_P;
      w = modScalar(w * seed);
    }
    return { compositeM, compositeZ };
  }

  public issuerEvaluateBatch(
    issuer: VOPRFIssuerKeys,
    blindedInputs: bigint[],
    corruptIndex?: number,
  ): BatchedVOPRFResponse {
    if (blindedInputs.length === 0) throw new Error('Blinded input batch cannot be empty');
    const evaluatedOutputs = blindedInputs.map((m, idx) => {
      const z = modPow(m, issuer.secretKey, SAFE_PRIME_P);
      return corruptIndex === idx ? (z * BASE_G) % SAFE_PRIME_P : z;
    });

    const foldingSeed = hashToScalar(
      'VOPRF-FOLD-SEED-V1',
      issuer.issuerId,
      issuer.publicKey.toString(16),
      ...blindedInputs.map((m) => m.toString(16)),
      ...evaluatedOutputs.map((z) => z.toString(16)),
    );
    const { compositeM, compositeZ } = this.foldElements(blindedInputs, evaluatedOutputs, foldingSeed);

    const r = randomScalar();
    const dleqA = modPow(BASE_G, r, SAFE_PRIME_P);
    const dleqB = modPow(compositeM, r, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'VOPRF-BATCH-DLEQ-V1',
      issuer.issuerId,
      issuer.publicKey.toString(16),
      compositeM.toString(16),
      compositeZ.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const responseK = modScalar(r + challenge * issuer.secretKey);

    return {
      issuerId: issuer.issuerId,
      issuerPublicKey: issuer.publicKey,
      blindedInputs: [...blindedInputs],
      evaluatedOutputs,
      foldingSeed,
      dleqA,
      dleqB,
      challenge,
      responseK,
    };
  }

  public verifyBatchResponse(resp: BatchedVOPRFResponse): boolean {
    if (resp.blindedInputs.length === 0 || resp.blindedInputs.length !== resp.evaluatedOutputs.length) return false;
    const expectedSeed = hashToScalar(
      'VOPRF-FOLD-SEED-V1',
      resp.issuerId,
      resp.issuerPublicKey.toString(16),
      ...resp.blindedInputs.map((m) => m.toString(16)),
      ...resp.evaluatedOutputs.map((z) => z.toString(16)),
    );
    if (expectedSeed !== resp.foldingSeed) return false;

    const { compositeM, compositeZ } = this.foldElements(resp.blindedInputs, resp.evaluatedOutputs, resp.foldingSeed);
    const expectedC = hashToScalar(
      'VOPRF-BATCH-DLEQ-V1',
      resp.issuerId,
      resp.issuerPublicKey.toString(16),
      compositeM.toString(16),
      compositeZ.toString(16),
      resp.dleqA.toString(16),
      resp.dleqB.toString(16),
    );
    if (expectedC !== resp.challenge) return false;

    const eq1 = modPow(BASE_G, resp.responseK, SAFE_PRIME_P) ===
      (resp.dleqA * modPow(resp.issuerPublicKey, resp.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(compositeM, resp.responseK, SAFE_PRIME_P) ===
      (resp.dleqB * modPow(compositeZ, resp.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  public clientUnblindBatch(clientTokens: ClientBlindedToken[], resp: BatchedVOPRFResponse): UnblindedPrivacyToken[] {
    if (clientTokens.length !== resp.evaluatedOutputs.length) {
      throw new Error('Client token count mismatch with issuer response');
    }
    if (!this.verifyBatchResponse(resp)) {
      throw new Error('Issuer VOPRF batch DLEQ proof failed verification');
    }

    return clientTokens.map((tok, i) => {
      const invR = modInv(tok.blindingR, SUBGROUP_Q);
      const unblindedPointN = modPow(resp.evaluatedOutputs[i], invR, SAFE_PRIME_P);
      return {
        issuerId: resp.issuerId,
        nonceHex: tok.nonceHex,
        unblindedPointN,
      };
    });
  }

  public createRedemptionTicket(token: UnblindedPrivacyToken, requestBinding: string): TokenRedemptionTicket {
    const key = sha256Hex('VOPRF-TOKEN-KEY-V1', token.issuerId, token.nonceHex, token.unblindedPointN.toString(16));
    const redemptionMac = createHmac('sha256', key).update(requestBinding).digest('hex');
    return {
      issuerId: token.issuerId,
      nonceHex: token.nonceHex,
      requestBinding,
      redemptionMac,
    };
  }

  public verifyAndRedeemTicket(
    issuer: VOPRFIssuerKeys,
    ticket: TokenRedemptionTicket,
  ): { redeemed: boolean; doubleSpend: boolean } {
    if (ticket.issuerId !== issuer.issuerId) return { redeemed: false, doubleSpend: false };
    const expectedPointN = modPow(this.hashNonceToSubgroup(ticket.nonceHex), issuer.secretKey, SAFE_PRIME_P);
    const expectedKey = sha256Hex('VOPRF-TOKEN-KEY-V1', issuer.issuerId, ticket.nonceHex, expectedPointN.toString(16));
    const expectedMac = createHmac('sha256', expectedKey).update(ticket.requestBinding).digest('hex');
    if (expectedMac !== ticket.redemptionMac) {
      return { redeemed: false, doubleSpend: false };
    }

    const spendKey = `${issuer.issuerId}:${ticket.nonceHex}`;
    if (this.spentNonces.has(spendKey)) {
      return { redeemed: false, doubleSpend: true };
    }
    this.spentNonces.add(spendKey);
    return { redeemed: true, doubleSpend: false };
  }

  public serializeResponse(resp: BatchedVOPRFResponse): string {
    return JSON.stringify({
      issuerId: resp.issuerId,
      tokenCount: resp.evaluatedOutputs.length,
      foldingSeed: resp.foldingSeed.toString(16),
    });
  }
}
