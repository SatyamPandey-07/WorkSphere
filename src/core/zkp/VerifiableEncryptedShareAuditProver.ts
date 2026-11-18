import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Publicly Verifiable Secret Sharing (Schoenmakers PVSS) Auditor.
 *
 * Allows ANY external third-party auditor (not just shareholders!) to verify that a dealer
 * honestly encrypted Shamir shares of secret s = f(0) under each shareholder's public key
 * Y_i = g^{x_i} WITHOUT decrypting any share:
 *  1. Dealer chooses degree-(t-1) polynomial f(x) and publishes Pedersen/Feldman commitments
 *     C_k = H^{a_k} mod P (using independent generator H) AND encrypted shares E_i = Y_i^{f(i)}.
 *  2. For every shareholder i, dealer attaches a Chaum-Pedersen DLEQ proof certifying:
 *       log_H(prod_k C_k^{i^k}) == log_{Y_i}(E_i)   (both equal the hidden share f(i)!)
 *  3. ANY public verifier checks all N DLEQ proofs!
 *  4. During reconstruction, each participating shareholder i decrypts S_i = E_i^{x_i^{-1}} = g^{f(i)}
 *     with a DLEQ decryption proof (log_g(Y_i) == log_{S_i}(E_i)), and Lagrange interpolation in
 *     the exponent recovers the exact committed group secret G_secret = g^{f(0)}!
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
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('PVSS-SCHOENMAKERS-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface PVSSShareholder {
  id: number;
  secretKey: bigint;
  publicKey: bigint; // Y_i = g^{x_i}
}

export interface EncryptedShareEntry {
  shareholderId: number;
  recipientPubKey: bigint;
  encryptedShareE: bigint; // Y_i^{f(i)}
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  responseS: bigint;
}

export interface PVSSDistributionBundle {
  dealId: string;
  threshold: number;
  polyCommitmentsH: bigint[]; // C_k = H^{a_k}
  encryptedShares: EncryptedShareEntry[];
  expectedSecretElement: bigint; // g^{f(0)}
}

export interface DecryptedShareRelease {
  shareholderId: number;
  decryptedShareS: bigint; // g^{f(i)}
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  responseX: bigint;
}

export class VerifiableEncryptedShareAuditProver {
  public createShareholder(id: number, secret?: bigint): PVSSShareholder {
    if (id <= 0) throw new RangeError('Shareholder ID must be positive');
    const secretKey = secret !== undefined ? modScalar(secret) : randomScalar();
    if (secretKey === 0n) throw new Error('Secret key must be non-zero');
    return { id, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  private evalPoly(coeffs: bigint[], x: bigint): bigint {
    let acc = 0n;
    let xp = 1n;
    for (const c of coeffs) {
      acc = modScalar(acc + c * xp);
      xp = modScalar(xp * x);
    }
    return acc;
  }

  private evalCommitments(commitments: bigint[], x: bigint): bigint {
    let acc = 1n;
    let xp = 1n;
    for (const ck of commitments) {
      acc = (acc * modPow(ck, xp, SAFE_PRIME_P)) % SAFE_PRIME_P;
      xp = modScalar(xp * x);
    }
    return acc;
  }

  public dealEncryptedShares(
    dealId: string,
    threshold: number,
    shareholders: Array<Pick<PVSSShareholder, 'id' | 'publicKey'>>,
    secretScalar?: bigint,
    corruptShareholderId?: number,
  ): { bundle: PVSSDistributionBundle; secretScalar: bigint } {
    if (threshold < 2 || threshold > shareholders.length) {
      throw new RangeError('Threshold must be in [2, shareholders.length]');
    }
    const s0 = secretScalar !== undefined ? modScalar(secretScalar) : randomScalar();
    const coeffs = [s0];
    for (let k = 1; k < threshold; k++) coeffs.push(randomScalar());

    const polyCommitmentsH = coeffs.map((c) => modPow(BASE_H, c, SAFE_PRIME_P));
    const expectedSecretElement = modPow(BASE_G, s0, SAFE_PRIME_P);

    const encryptedShares: EncryptedShareEntry[] = shareholders.map((sh) => {
      const fVal = this.evalPoly(coeffs, BigInt(sh.id));
      const xCommitH = this.evalCommitments(polyCommitmentsH, BigInt(sh.id)); // H^{f(i)}
      let encryptedShareE = modPow(sh.publicKey, fVal, SAFE_PRIME_P);
      if (corruptShareholderId === sh.id) {
        encryptedShareE = (encryptedShareE * BASE_G) % SAFE_PRIME_P;
      }

      const w = randomScalar();
      const dleqA = modPow(BASE_H, w, SAFE_PRIME_P);
      const dleqB = modPow(sh.publicKey, w, SAFE_PRIME_P);
      const challenge = hashToScalar(
        'PVSS-DEAL-DLEQ-V1',
        dealId,
        String(sh.id),
        xCommitH.toString(16),
        sh.publicKey.toString(16),
        encryptedShareE.toString(16),
        dleqA.toString(16),
        dleqB.toString(16),
      );
      const responseS = modScalar(w + challenge * fVal);

      return {
        shareholderId: sh.id,
        recipientPubKey: sh.publicKey,
        encryptedShareE,
        dleqA,
        dleqB,
        challenge,
        responseS,
      };
    });

    return {
      bundle: { dealId, threshold, polyCommitmentsH, encryptedShares, expectedSecretElement },
      secretScalar: s0,
    };
  }

  /**
   * Public third-party audit: verifies EVERY encrypted share against polynomial commitments
   * WITHOUT requiring any shareholder secret key!
   */
  public auditDistributionPublicly(bundle: PVSSDistributionBundle): { allValid: boolean; faultyShareholderIds: number[] } {
    if (bundle.polyCommitmentsH.length !== bundle.threshold || bundle.encryptedShares.length < bundle.threshold) {
      return { allValid: false, faultyShareholderIds: bundle.encryptedShares.map((e) => e.shareholderId) };
    }

    const faultyShareholderIds: number[] = [];
    for (const entry of bundle.encryptedShares) {
      const xCommitH = this.evalCommitments(bundle.polyCommitmentsH, BigInt(entry.shareholderId));
      const expectedC = hashToScalar(
        'PVSS-DEAL-DLEQ-V1',
        bundle.dealId,
        String(entry.shareholderId),
        xCommitH.toString(16),
        entry.recipientPubKey.toString(16),
        entry.encryptedShareE.toString(16),
        entry.dleqA.toString(16),
        entry.dleqB.toString(16),
      );
      if (expectedC !== entry.challenge) {
        faultyShareholderIds.push(entry.shareholderId);
        continue;
      }
      const eq1 = modPow(BASE_H, entry.responseS, SAFE_PRIME_P) ===
        (entry.dleqA * modPow(xCommitH, entry.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const eq2 = modPow(entry.recipientPubKey, entry.responseS, SAFE_PRIME_P) ===
        (entry.dleqB * modPow(entry.encryptedShareE, entry.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (!eq1 || !eq2) faultyShareholderIds.push(entry.shareholderId);
    }

    return { allValid: faultyShareholderIds.length === 0, faultyShareholderIds };
  }

  public decryptAndProveShare(
    bundle: PVSSDistributionBundle,
    shareholder: PVSSShareholder,
    corruptDecryption = false,
  ): DecryptedShareRelease {
    const entry = bundle.encryptedShares.find((e) => e.shareholderId === shareholder.id);
    if (!entry) throw new Error(`Shareholder ${shareholder.id} not found in bundle`);

    const invX = modInv(shareholder.secretKey, SUBGROUP_Q);
    let decryptedShareS = modPow(entry.encryptedShareE, invX, SAFE_PRIME_P); // g^{f(i)}
    if (corruptDecryption) decryptedShareS = (decryptedShareS * BASE_G) % SAFE_PRIME_P;

    // DLEQ proof: log_g(Y_i) == log_{S_i}(E_i) == x_i
    const w = randomScalar();
    const dleqA = modPow(BASE_G, w, SAFE_PRIME_P);
    const dleqB = modPow(decryptedShareS, w, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'PVSS-DEC-DLEQ-V1',
      bundle.dealId,
      String(shareholder.id),
      shareholder.publicKey.toString(16),
      decryptedShareS.toString(16),
      entry.encryptedShareE.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const responseX = modScalar(w + challenge * shareholder.secretKey);
    return { shareholderId: shareholder.id, decryptedShareS, dleqA, dleqB, challenge, responseX };
  }

  public verifyDecryptedShare(bundle: PVSSDistributionBundle, release: DecryptedShareRelease): boolean {
    const entry = bundle.encryptedShares.find((e) => e.shareholderId === release.shareholderId);
    if (!entry) return false;
    const expectedC = hashToScalar(
      'PVSS-DEC-DLEQ-V1',
      bundle.dealId,
      String(release.shareholderId),
      entry.recipientPubKey.toString(16),
      release.decryptedShareS.toString(16),
      entry.encryptedShareE.toString(16),
      release.dleqA.toString(16),
      release.dleqB.toString(16),
    );
    if (expectedC !== release.challenge) return false;
    const eq1 = modPow(BASE_G, release.responseX, SAFE_PRIME_P) ===
      (release.dleqA * modPow(entry.recipientPubKey, release.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(release.decryptedShareS, release.responseX, SAFE_PRIME_P) ===
      (release.dleqB * modPow(entry.encryptedShareE, release.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  public reconstructSecretElement(
    bundle: PVSSDistributionBundle,
    releases: DecryptedShareRelease[],
  ): { recoveredElement: bigint | null; faultyDecryptors: number[] } {
    const valid: DecryptedShareRelease[] = [];
    const faultyDecryptors: number[] = [];
    const seen = new Set<number>();

    for (const rel of releases) {
      if (seen.has(rel.shareholderId) || !this.verifyDecryptedShare(bundle, rel)) {
        faultyDecryptors.push(rel.shareholderId);
      } else {
        seen.add(rel.shareholderId);
        valid.push(rel);
      }
    }

    if (valid.length < bundle.threshold) return { recoveredElement: null, faultyDecryptors };

    const quorum = valid.slice(0, bundle.threshold);
    const ids = quorum.map((q) => q.shareholderId);
    let recovered = 1n;
    for (const q of quorum) {
      const xi = BigInt(q.shareholderId);
      let num = 1n;
      let den = 1n;
      for (const other of ids) {
        if (other === q.shareholderId) continue;
        const xj = BigInt(other);
        num = modScalar(num * modScalar(SUBGROUP_Q - xj));
        den = modScalar(den * modScalar(xi - xj));
      }
      const lambda = modScalar(num * modInv(den, SUBGROUP_Q));
      recovered = (recovered * modPow(q.decryptedShareS, lambda, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    return { recoveredElement: recovered, faultyDecryptors };
  }

  public serializeBundle(bundle: PVSSDistributionBundle): string {
    return JSON.stringify({
      dealId: bundle.dealId,
      threshold: bundle.threshold,
      shareholderCount: bundle.encryptedShares.length,
    });
  }
}
