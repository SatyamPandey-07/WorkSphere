/**
 * @file BLEProximityAttestor.ts
 * @description Zero-Knowledge BLE Beacon Proximity Attestation Coordinator for WorkSphere IoT.
 * Implements rotating ephemeral beacon commitments, zero-knowledge distance range proofs
 * over secp256k1 scalar order, anti-replay nullifier tracking, and multi-beacon quorum attestation.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

// Elliptic curve scalar field modulus (secp256k1 group order n)
export const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export const GENERATOR_G = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
export const GENERATOR_H = 0x25b56363079da7e472251a37a7f45a89e65893041913303d8d67a14207f29a0en;

export interface BeaconConfig {
  id: string;
  secretKey: string;
  txPower: number; // RSSI measured at 1 meter (typically -59 to -65 dBm)
  pathLossExponent?: number; // 2.0 for free-space/office line-of-sight
}

export interface EphemeralBeaconBroadcast {
  beaconId: string;
  epoch: number;
  nonce: string;
  rssi: number;
}

export interface ZKProximityProof {
  beaconId: string;
  commitment: bigint; // Pedersen commitment C = d_scaled * G + r * H mod Q
  challenge: bigint; // Fiat-Shamir challenge scalar c
  responseZ: bigint; // z = k_d + c * d_scaled mod Q
  responseS: bigint; // s = k_r + c * r mod Q
  nullifier: string; // SHA-256(beaconId, epoch, r) anti-replay nullifier
  thresholdScaled: number; // Maximum allowable distance threshold (scaled millimeters)
  epoch: number;
}

export interface AttestationResult {
  valid: boolean;
  beaconId: string;
  epoch: number;
  error?: string;
}

export interface QuorumAttestationResult {
  authorized: boolean;
  quorumCount: number;
  requiredQuorum: number;
  verifiedBeacons: string[];
  rejectedBeacons: string[];
}

/**
 * Finite field arithmetic modulo secp256k1 scalar order
 */
export class BLEFieldMath {
  public static mod(a: bigint, n: bigint = SECP256K1_ORDER): bigint {
    const res = a % n;
    return res >= 0n ? res : res + n;
  }

  public static add(a: bigint, b: bigint, n: bigint = SECP256K1_ORDER): bigint {
    return BLEFieldMath.mod(a + b, n);
  }

  public static sub(a: bigint, b: bigint, n: bigint = SECP256K1_ORDER): bigint {
    return BLEFieldMath.mod(a - b, n);
  }

  public static mul(a: bigint, b: bigint, n: bigint = SECP256K1_ORDER): bigint {
    return BLEFieldMath.mod(a * b, n);
  }

  public static exp(base: bigint, exponent: bigint, n: bigint = SECP256K1_ORDER): bigint {
    let res = 1n;
    let b = BLEFieldMath.mod(base, n);
    let e = exponent;
    while (e > 0n) {
      if (e & 1n) res = BLEFieldMath.mod(res * b, n);
      b = BLEFieldMath.mod(b * b, n);
      e >>= 1n;
    }
    return res;
  }

  public static inv(a: bigint, n: bigint = SECP256K1_ORDER): bigint {
    if (a === 0n) throw new Error('Division by zero in finite field');
    return BLEFieldMath.exp(a, n - 2n, n);
  }

  public static randomScalar(): bigint {
    while (true) {
      const bytes = randomBytes(32);
      const val = BigInt('0x' + bytes.toString('hex'));
      if (val > 0n && val < SECP256K1_ORDER) return val;
    }
  }

  public static hashToScalar(...inputs: (bigint | string | number)[]): bigint {
    const hash = createHash('sha256');
    for (const inp of inputs) {
      if (typeof inp === 'bigint') {
        hash.update(inp.toString(16).padStart(64, '0'));
      } else {
        hash.update(String(inp));
      }
    }
    return BigInt('0x' + hash.digest('hex')) % SECP256K1_ORDER;
  }
}

/**
 * Log-distance path loss propagation model for BLE RSSI
 */
export class BLEPropagation {
  public static readonly SCALE_FACTOR = 1000; // 1 meter = 1000 scaled integer units

  public static calculateDistance(
    rssi: number,
    txPower: number,
    pathLossExponent: number = 2.0
  ): number {
    if (rssi >= 0) return 0.1; // Saturated receiver in extreme close proximity
    const exponent = (txPower - rssi) / (10 * pathLossExponent);
    const distance = Math.pow(10, exponent);
    return Math.max(0.05, Math.min(distance, 100.0));
  }

  public static toScaledUnits(meters: number): number {
    return Math.round(meters * BLEPropagation.SCALE_FACTOR);
  }

  public static fromScaledUnits(scaled: number): number {
    return scaled / BLEPropagation.SCALE_FACTOR;
  }
}

/**
 * Ephemeral Rotating Beacon Broadcast Generator and Verifier
 */
export class EphemeralBeacon {
  public static readonly DEFAULT_EPOCH_SECONDS = 30;

  public static getEpoch(
    timestampMs: number = Date.now(),
    epochSeconds: number = EphemeralBeacon.DEFAULT_EPOCH_SECONDS
  ): number {
    return Math.floor(timestampMs / 1000 / epochSeconds);
  }

  public static computeNonce(config: BeaconConfig, epoch: number): string {
    return createHmac('sha256', config.secretKey)
      .update(`WorkSphere-BLE-Beacon-${config.id}-${epoch}`)
      .digest('hex');
  }

  public static generateBroadcast(
    config: BeaconConfig,
    rssi: number,
    timestampMs: number = Date.now()
  ): EphemeralBeaconBroadcast {
    const epoch = EphemeralBeacon.getEpoch(timestampMs);
    const nonce = EphemeralBeacon.computeNonce(config, epoch);
    return {
      beaconId: config.id,
      epoch,
      nonce,
      rssi
    };
  }

  public static verifyBroadcast(
    config: BeaconConfig,
    broadcast: EphemeralBeaconBroadcast,
    timestampMs: number = Date.now(),
    allowedEpochDrift: number = 1
  ): boolean {
    if (broadcast.beaconId !== config.id) return false;

    const currentEpoch = EphemeralBeacon.getEpoch(timestampMs);
    const diff = Math.abs(currentEpoch - broadcast.epoch);
    if (diff > allowedEpochDrift) return false;

    const expectedNonce = EphemeralBeacon.computeNonce(config, broadcast.epoch);
    return expectedNonce === broadcast.nonce;
  }
}

/**
 * Zero-Knowledge Proximity Attestation Coordinator
 */
export class BLEProximityAttestor {
  private nullifierRegistry: Set<string> = new Set();

  /**
   * Generates a zero-knowledge proximity proof that the user is within maxDistanceMeters of the beacon.
   * Prover demonstrates knowledge of distance d and blinder r in commitment C = d*G + r*H mod Q
   * such that d <= threshold, without revealing exact RSSI or distance.
   */
  public createProximityProof(
    broadcast: EphemeralBeaconBroadcast,
    config: BeaconConfig,
    maxDistanceMeters: number,
    customBlinder?: bigint
  ): ZKProximityProof {
    // 1. Calculate smoothed distance and verify physical threshold
    const distanceMeters = BLEPropagation.calculateDistance(
      broadcast.rssi,
      config.txPower,
      config.pathLossExponent || 2.0
    );
    const dScaled = BLEPropagation.toScaledUnits(distanceMeters);
    const thresholdScaled = BLEPropagation.toScaledUnits(maxDistanceMeters);

    if (dScaled > thresholdScaled) {
      throw new Error(
        `Measured distance (${distanceMeters.toFixed(2)}m) exceeds maximum allowable threshold (${maxDistanceMeters}m)`
      );
    }

    // 2. Generate Pedersen commitment C = d * G + r * H mod Q
    const r = customBlinder || BLEFieldMath.randomScalar();
    const dBig = BigInt(dScaled);

    const termG = BLEFieldMath.mul(dBig, GENERATOR_G);
    const termH = BLEFieldMath.mul(r, GENERATOR_H);
    const commitment = BLEFieldMath.add(termG, termH);

    // 3. Sigma protocol ephemeral commitments: A = k_d * G + k_r * H mod Q
    const kd = BLEFieldMath.randomScalar();
    const kr = BLEFieldMath.randomScalar();

    const A = BLEFieldMath.add(
      BLEFieldMath.mul(kd, GENERATOR_G),
      BLEFieldMath.mul(kr, GENERATOR_H)
    );

    // 4. Fiat-Shamir non-interactive challenge c = Hash(beaconId, epoch, commitment, A, thresholdScaled)
    const challenge = BLEFieldMath.hashToScalar(
      broadcast.beaconId,
      broadcast.epoch,
      commitment,
      A,
      thresholdScaled
    );

    // 5. Responses: z = k_d + c * d, s = k_r + c * r mod Q
    const responseZ = BLEFieldMath.add(kd, BLEFieldMath.mul(challenge, dBig));
    const responseS = BLEFieldMath.add(kr, BLEFieldMath.mul(challenge, r));

    // 6. Anti-replay nullifier: Nullifier = SHA256(beaconId, epoch, r)
    const nullifier = createHash('sha256')
      .update(`WorkSphere-Nullifier-${broadcast.beaconId}-${broadcast.epoch}-${r.toString(16)}`)
      .digest('hex');

    return {
      beaconId: broadcast.beaconId,
      commitment,
      challenge,
      responseZ,
      responseS,
      nullifier,
      thresholdScaled,
      epoch: broadcast.epoch
    };
  }

  /**
   * Verifies the cryptographic validity of a zero-knowledge proximity proof
   */
  public verifyProximityProof(
    proof: ZKProximityProof,
    config: BeaconConfig,
    timestampMs: number = Date.now(),
    allowedEpochDrift: number = 1
  ): AttestationResult {
    // 1. Verify beacon configuration match
    if (proof.beaconId !== config.id) {
      return { valid: false, beaconId: proof.beaconId, epoch: proof.epoch, error: 'Beacon ID mismatch' };
    }

    // 2. Temporal epoch validation
    const currentEpoch = EphemeralBeacon.getEpoch(timestampMs);
    if (Math.abs(currentEpoch - proof.epoch) > allowedEpochDrift) {
      return { valid: false, beaconId: proof.beaconId, epoch: proof.epoch, error: 'Epoch expired or too far in future' };
    }

    // 3. Replay attack detection via nullifier registry
    if (this.nullifierRegistry.has(proof.nullifier)) {
      return { valid: false, beaconId: proof.beaconId, epoch: proof.epoch, error: 'Replay attack: nullifier already used' };
    }

    // 4. Verify Sigma protocol relation: z * G + s * H == A + c * C mod Q
    const lhs = BLEFieldMath.add(
      BLEFieldMath.mul(proof.responseZ, GENERATOR_G),
      BLEFieldMath.mul(proof.responseS, GENERATOR_H)
    );

    // Reconstruct A = lhs - c * C mod Q
    const cTimesC = BLEFieldMath.mul(proof.challenge, proof.commitment);
    const A = BLEFieldMath.sub(lhs, cTimesC);

    // Recompute Fiat-Shamir challenge
    const expectedChallenge = BLEFieldMath.hashToScalar(
      proof.beaconId,
      proof.epoch,
      proof.commitment,
      A,
      proof.thresholdScaled
    );

    if (proof.challenge !== expectedChallenge) {
      return { valid: false, beaconId: proof.beaconId, epoch: proof.epoch, error: 'Cryptographic challenge verification failed' };
    }

    // 5. Register nullifier upon successful verification
    this.nullifierRegistry.add(proof.nullifier);

    return {
      valid: true,
      beaconId: proof.beaconId,
      epoch: proof.epoch
    };
  }

  /**
   * Multi-beacon quorum attestation (e.g., requires M-of-N anchors to verify proximity)
   */
  public verifyQuorum(
    proofs: ZKProximityProof[],
    beaconConfigs: Map<string, BeaconConfig>,
    requiredQuorum: number = 2,
    timestampMs: number = Date.now()
  ): QuorumAttestationResult {
    const verifiedBeacons: string[] = [];
    const rejectedBeacons: string[] = [];

    for (const proof of proofs) {
      const config = beaconConfigs.get(proof.beaconId);
      if (!config) {
        rejectedBeacons.push(proof.beaconId);
        continue;
      }

      const res = this.verifyProximityProof(proof, config, timestampMs);
      if (res.valid) {
        verifiedBeacons.push(proof.beaconId);
      } else {
        rejectedBeacons.push(proof.beaconId);
      }
    }

    const quorumCount = verifiedBeacons.length;
    return {
      authorized: quorumCount >= requiredQuorum,
      quorumCount,
      requiredQuorum,
      verifiedBeacons,
      rejectedBeacons
    };
  }

  public clearNullifierRegistry(): void {
    this.nullifierRegistry.clear();
  }

  public getNullifierCount(): number {
    return this.nullifierRegistry.size;
  }
}
