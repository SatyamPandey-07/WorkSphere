/**
 * @file ObliviousTransferBatchProver.ts
 * @description Chou-Orlandi 1-out-of-N Oblivious Transfer (OT) batch protocol with
 * Fiat-Shamir Schnorr sender-setup proofs and auditable transcript digests.
 *
 * Implements:
 * - Safe-prime subgroup (P = 2Q + 1) Diffie-Hellman OT key derivation
 * - Sender setup A = g^a mod P with Schnorr proof of knowledge of secret a
 * - Receiver choice commitment B = g^b * A^choiceIndex mod P (information-theoretically hiding choice)
 * - Per-slot symmetric key K_i = SHA-256(B / A^i)^a and authenticated XOR-stream encryption
 * - Receiver decryption of ONLY the chosen message M_{choiceIndex} with integrity tag verification
 */

import { createHash, randomBytes } from 'crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

function modNorm(x: bigint, mod: bigint): bigint {
  const r = x % mod;
  return r >= 0n ? r : r + mod;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  if (e < 0n) throw new RangeError('Exponent must be non-negative');
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modInverse(a: bigint, mod: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = mod;
  let newR = modNorm(a, mod);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r !== 1n) throw new Error('Element not invertible modulo P');
  return t < 0n ? t + mod : t;
}

function randomScalar(): bigint {
  const raw = BigInt('0x' + randomBytes(32).toString('hex'));
  return (raw % (SUBGROUP_Q - 1n)) + 1n;
}

function hashScalar(domain: string, parts: Array<string | bigint>): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(typeof p === 'bigint' ? p.toString(16) : p);
  }
  return (BigInt('0x' + h.digest('hex')) % (SUBGROUP_Q - 1n)) + 1n;
}

function deriveStreamKey(sessionId: string, slotIndex: number, sharedPoint: bigint): Buffer {
  return createHash('sha256')
    .update(`WorkSphere::OTKey|${sessionId}|${slotIndex}|${sharedPoint.toString(16)}`)
    .digest();
}

function xorStream(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  let blockIndex = 0;
  let offset = 0;
  while (offset < data.length) {
    const pad = createHash('sha256')
      .update(key)
      .update(Buffer.from([blockIndex & 0xff, (blockIndex >> 8) & 0xff]))
      .digest();
    for (let i = 0; i < pad.length && offset < data.length; i++, offset++) {
      out[offset] = data[offset] ^ pad[i];
    }
    blockIndex++;
  }
  return out;
}

function computeMac(key: Buffer, ciphertext: Buffer): string {
  return createHash('sha256').update(key).update(ciphertext).digest('hex');
}

export interface SenderSetup {
  readonly sessionId: string;
  readonly publicA: bigint;
  readonly proofNonce: bigint;
  readonly proofResponse: bigint;
}

export interface SenderSecretState {
  readonly setup: SenderSetup;
  readonly secretA: bigint;
}

export interface ReceiverChoiceState {
  readonly sessionId: string;
  readonly choiceIndex: number;
  readonly secretB: bigint;
  readonly blindedChoiceB: bigint;
}

export interface EncryptedOTSlot {
  readonly slotIndex: number;
  readonly ciphertextHex: string;
  readonly macHex: string;
}

export interface OTBatchTransferBundle {
  readonly sessionId: string;
  readonly setup: SenderSetup;
  readonly blindedChoiceB: bigint;
  readonly slots: readonly EncryptedOTSlot[];
  readonly transcriptDigest: string;
}

export class ObliviousTransferBatchProver {
  public readonly p: bigint;
  public readonly q: bigint;
  public readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    this.p = p;
    this.q = q;
    this.g = g;
  }

  /**
   * Sender initializes OT session with public point A = g^a mod P and Schnorr PoK.
   */
  public initSender(sessionId: string): SenderSecretState {
    const secretA = randomScalar();
    const publicA = modPow(this.g, secretA, this.p);
    const w = randomScalar();
    const proofNonce = modPow(this.g, w, this.p);
    const e = hashScalar('WorkSphere::OTSenderSetup', [sessionId, publicA, proofNonce]);
    const proofResponse = modNorm(w + e * secretA, this.q);

    return {
      setup: { sessionId, publicA, proofNonce, proofResponse },
      secretA,
    };
  }

  public verifySenderSetup(setup: SenderSetup): boolean {
    if (setup.publicA <= 1n || setup.publicA >= this.p) return false;
    const e = hashScalar('WorkSphere::OTSenderSetup', [
      setup.sessionId,
      setup.publicA,
      setup.proofNonce,
    ]);
    const lhs = modPow(this.g, modNorm(setup.proofResponse, this.q), this.p);
    const rhs = (setup.proofNonce * modPow(setup.publicA, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Receiver blinds their chosen index c in [0, totalSlots - 1] into B = g^b * A^c mod P.
   */
  public createReceiverChoice(
    setup: SenderSetup,
    choiceIndex: number,
    totalSlots: number
  ): ReceiverChoiceState {
    if (!this.verifySenderSetup(setup)) {
      throw new Error('Sender setup Schnorr proof failed verification');
    }
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= totalSlots) {
      throw new RangeError(`choiceIndex must be in [0, ${totalSlots - 1}]`);
    }

    const secretB = randomScalar();
    const blindedChoiceB =
      (modPow(this.g, secretB, this.p) * modPow(setup.publicA, BigInt(choiceIndex), this.p)) %
      this.p;

    return {
      sessionId: setup.sessionId,
      choiceIndex,
      secretB,
      blindedChoiceB,
    };
  }

  /**
   * Sender encrypts all N messages under per-slot keys K_i = H((B / A^i)^a mod P).
   * Only slot i == choiceIndex matches the receiver's derived key H(A^b mod P).
   */
  public encryptBatchSlots(
    senderState: SenderSecretState,
    blindedChoiceB: bigint,
    messages: readonly string[]
  ): OTBatchTransferBundle {
    if (messages.length === 0) {
      throw new Error('At least one message slot is required');
    }
    if (blindedChoiceB <= 1n || blindedChoiceB >= this.p) {
      throw new Error('Invalid receiver blinded point B');
    }

    const { setup, secretA } = senderState;
    const invA = modInverse(setup.publicA, this.p);
    const slots: EncryptedOTSlot[] = [];

    for (let i = 0; i < messages.length; i++) {
      const basePoint = (blindedChoiceB * modPow(invA, BigInt(i), this.p)) % this.p;
      const sharedPoint = modPow(basePoint, secretA, this.p);
      const key = deriveStreamKey(setup.sessionId, i, sharedPoint);
      const plaintext = Buffer.from(messages[i], 'utf8');
      const ciphertext = xorStream(plaintext, key);
      const macHex = computeMac(key, ciphertext);

      slots.push({
        slotIndex: i,
        ciphertextHex: ciphertext.toString('hex'),
        macHex,
      });
    }

    const transcriptDigest = createHash('sha256')
      .update(`${setup.sessionId}|${setup.publicA.toString(16)}|${blindedChoiceB.toString(16)}|${slots.length}`)
      .digest('hex');

    return {
      sessionId: setup.sessionId,
      setup,
      blindedChoiceB,
      slots,
      transcriptDigest,
    };
  }

  /**
   * Receiver decrypts and authenticates ONLY their chosen message slot.
   */
  public decryptChosenSlot(
    bundle: OTBatchTransferBundle,
    receiverState: ReceiverChoiceState
  ): { valid: boolean; plaintext?: string; reason?: string } {
    if (!this.verifySenderSetup(bundle.setup)) {
      return { valid: false, reason: 'Invalid sender setup proof' };
    }
    if (bundle.sessionId !== receiverState.sessionId) {
      return { valid: false, reason: 'Session ID mismatch' };
    }

    const slot = bundle.slots[receiverState.choiceIndex];
    if (!slot) {
      return { valid: false, reason: 'Chosen slot missing from transfer bundle' };
    }

    const sharedPoint = modPow(bundle.setup.publicA, receiverState.secretB, this.p);
    const key = deriveStreamKey(bundle.sessionId, receiverState.choiceIndex, sharedPoint);
    const ciphertext = Buffer.from(slot.ciphertextHex, 'hex');
    const expectedMac = computeMac(key, ciphertext);

    if (expectedMac !== slot.macHex) {
      return { valid: false, reason: 'MAC integrity check failed for chosen slot' };
    }

    const plaintext = xorStream(ciphertext, key).toString('utf8');
    return { valid: true, plaintext };
  }

  /**
   * Executes a multi-index batched oblivious transfer where the receiver fetches k distinct
   * secret records across independent blinded receiver queries bound to one sender setup.
   */
  public executeMultiQueryBatch(
    senderState: SenderSecretState,
    messages: readonly string[],
    choiceIndices: readonly number[]
  ): {
    queries: Array<{
      choiceIndex: number;
      receiverState: ReceiverChoiceState;
      bundle: OTBatchTransferBundle;
      decrypted: string;
    }>;
    batchReceiptDigest: string;
  } {
    if (choiceIndices.length === 0) {
      throw new Error('At least one choice index is required for multi-query OT batch');
    }

    const queries: Array<{
      choiceIndex: number;
      receiverState: ReceiverChoiceState;
      bundle: OTBatchTransferBundle;
      decrypted: string;
    }> = [];

    for (const choiceIndex of choiceIndices) {
      const receiverState = this.createReceiverChoice(senderState.setup, choiceIndex, messages.length);
      const bundle = this.encryptBatchSlots(senderState, receiverState.blindedChoiceB, messages);
      const res = this.decryptChosenSlot(bundle, receiverState);
      if (!res.valid || res.plaintext === undefined) {
        throw new Error(`Multi-query OT failed at index ${choiceIndex}: ${res.reason}`);
      }
      queries.push({
        choiceIndex,
        receiverState,
        bundle,
        decrypted: res.plaintext,
      });
    }

    const batchReceiptDigest = createHash('sha256')
      .update(
        queries
          .map((q) => `${q.bundle.sessionId}:${q.bundle.transcriptDigest}:${q.bundle.slots.length}`)
          .join('|')
      )
      .digest('hex');

    return { queries, batchReceiptDigest };
  }

  /**
   * Audits an OT transfer bundle for public transcript consistency without requiring
   * either the sender's secret scalar or the receiver's private choice index.
   */
  public auditTransferBundle(bundle: OTBatchTransferBundle): {
    valid: boolean;
    slotCount: number;
    reason?: string;
  } {
    if (!this.verifySenderSetup(bundle.setup)) {
      return { valid: false, slotCount: bundle.slots.length, reason: 'Invalid sender Schnorr setup proof' };
    }
    if (bundle.sessionId !== bundle.setup.sessionId) {
      return { valid: false, slotCount: bundle.slots.length, reason: 'Bundle session ID mismatch' };
    }
    if (bundle.blindedChoiceB <= 1n || bundle.blindedChoiceB >= this.p) {
      return { valid: false, slotCount: bundle.slots.length, reason: 'Out-of-range blinded choice point' };
    }
    const expectedDigest = createHash('sha256')
      .update(
        `${bundle.setup.sessionId}|${bundle.setup.publicA.toString(16)}|${bundle.blindedChoiceB.toString(16)}|${bundle.slots.length}`
      )
      .digest('hex');
    if (expectedDigest !== bundle.transcriptDigest) {
      return { valid: false, slotCount: bundle.slots.length, reason: 'Transcript digest mismatch' };
    }
    for (let i = 0; i < bundle.slots.length; i++) {
      if (bundle.slots[i].slotIndex !== i) {
        return { valid: false, slotCount: bundle.slots.length, reason: `Non-contiguous slot index at ${i}` };
      }
      if (bundle.slots[i].macHex.length !== 64) {
        return { valid: false, slotCount: bundle.slots.length, reason: `Malformed MAC at slot ${i}` };
      }
    }
    return { valid: true, slotCount: bundle.slots.length };
  }

  /**
   * Verifies that a receiver CANNOT decrypt any non-chosen slot using their single private scalar b
   * (computational receiver-privacy / sender-privacy sanity probe).
   */
  public verifyNonChosenSlotsUnreadable(
    bundle: OTBatchTransferBundle,
    receiverState: ReceiverChoiceState
  ): boolean {
    for (let i = 0; i < bundle.slots.length; i++) {
      if (i === receiverState.choiceIndex) continue;
      const forgedState: ReceiverChoiceState = { ...receiverState, choiceIndex: i };
      const attempt = this.decryptChosenSlot(bundle, forgedState);
      if (attempt.valid) return false;
    }
    return true;
  }

  /**
   * Serializes an OTBatchTransferBundle into a portable JSON payload for wire transport.
   */
  public serializeBundle(bundle: OTBatchTransferBundle): string {
    return JSON.stringify({
      sessionId: bundle.sessionId,
      setup: {
        sessionId: bundle.setup.sessionId,
        publicA: bundle.setup.publicA.toString(16),
        proofNonce: bundle.setup.proofNonce.toString(16),
        proofResponse: bundle.setup.proofResponse.toString(16),
      },
      blindedChoiceB: bundle.blindedChoiceB.toString(16),
      slots: bundle.slots,
      transcriptDigest: bundle.transcriptDigest,
    });
  }

  /**
   * Restores an OTBatchTransferBundle from its serialized JSON transport payload.
   */
  public deserializeBundle(payload: string): OTBatchTransferBundle {
    const parsed = JSON.parse(payload) as {
      sessionId: string;
      setup: { sessionId: string; publicA: string; proofNonce: string; proofResponse: string };
      blindedChoiceB: string;
      slots: EncryptedOTSlot[];
      transcriptDigest: string;
    };
    return {
      sessionId: parsed.sessionId,
      setup: {
        sessionId: parsed.setup.sessionId,
        publicA: BigInt(`0x${parsed.setup.publicA}`),
        proofNonce: BigInt(`0x${parsed.setup.proofNonce}`),
        proofResponse: BigInt(`0x${parsed.setup.proofResponse}`),
      },
      blindedChoiceB: BigInt(`0x${parsed.blindedChoiceB}`),
      slots: parsed.slots,
      transcriptDigest: parsed.transcriptDigest,
    };
  }
}
