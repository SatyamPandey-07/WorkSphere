import { createHash } from 'crypto';

/**
 * Recursive Proof-Carrying Cross-Chain ZK State Bridge Verifier
 *
 * Implements a recursive light-client state bridge verifier over a safe-prime
 * subgroup (P = 2Q + 1):
 *   1. Weighted validator sets with Schnorr signature quorum certificates (+2/3 power)
 *   2. Recursive epoch-header Pedersen commitment accumulation folding each
 *      finalized epoch header + next-epoch validator set hash into a single
 *      running recursive state accumulator
 *   3. Cross-chain message Merkle inclusion verification against finalized
 *      bridge state roots
 */

const SUBGROUP_ORDER = 0x7fffffffffffffffffffffffffffe1d3n; // Prime Q
const SAFE_PRIME = 0xffffffffffffffffffffffffffffc3a7n; // Safe prime P = 2Q + 1
const SUBGROUP_GEN = 4n;

export interface BridgeValidator {
  readonly validatorId: string;
  readonly votingPower: bigint;
  readonly witnessScalar: bigint;
  readonly publicPoint: bigint;
}

export interface ValidatorSignature {
  readonly validatorId: string;
  readonly noncePointR: bigint;
  readonly responseS: bigint;
}

export interface EpochBridgeHeader {
  readonly epoch: number;
  readonly parentHeaderHash: string;
  readonly stateRoot: string;
  readonly nextValidatorSetHash: string;
  readonly headerHash: string;
  readonly signatures: readonly ValidatorSignature[];
}

export interface RecursiveBridgeStepProof {
  readonly epoch: number;
  readonly headerHash: string;
  readonly stateRoot: string;
  readonly signedPower: bigint;
  readonly totalPower: bigint;
  readonly foldingChallenge: bigint;
  readonly headerCommitment: bigint;
  readonly updatedAccumulator: bigint;
  readonly transcriptDigest: string;
}

export interface RecursiveBridgeProof {
  readonly genesisHash: string;
  readonly genesisValidatorSetHash: string;
  readonly steps: readonly RecursiveBridgeStepProof[];
  readonly finalEpoch: number;
  readonly finalStateRoot: string;
  readonly finalAccumulator: bigint;
  readonly finalTranscriptDigest: string;
}

export interface BridgeMessageMerkleStep {
  readonly siblingHash: string;
  readonly isRightSibling: boolean;
}

export interface CrossChainMessageProof {
  readonly messageId: string;
  readonly payloadHash: string;
  readonly leafHash: string;
  readonly merklePath: readonly BridgeMessageMerkleStep[];
}

export interface BridgeVerificationResult {
  readonly isValid: boolean;
  readonly verifiedEpochs: number;
  readonly finalStateRoot: string;
  readonly reason?: string;
}

function modQ(x: bigint): bigint {
  const r = x % SUBGROUP_ORDER;
  return r >= 0n ? r : r + SUBGROUP_ORDER;
}

function modP(x: bigint): bigint {
  const r = x % SAFE_PRIME;
  return r >= 0n ? r : r + SAFE_PRIME;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function hashToScalar(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modQ(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function hashHex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  return h.digest('hex');
}

export class RecursiveSNARKBridgeVerifier {
  private readonly genH: bigint;

  constructor(domainSeed = 'WORKSPHERE_ZK_BRIDGE_V1') {
    this.genH = modPow(SUBGROUP_GEN, hashToScalar('BRIDGE_GEN_H', [domainSeed]), SAFE_PRIME);
  }

  public createValidator(validatorId: string, votingPower: bigint, seed: string): BridgeValidator {
    if (votingPower <= 0n) throw new Error('votingPower must be positive');
    const witnessScalar = hashToScalar('BRIDGE_VAL_SK', [validatorId, seed]);
    const publicPoint = modPow(SUBGROUP_GEN, witnessScalar, SAFE_PRIME);
    return { validatorId, votingPower, witnessScalar, publicPoint };
  }

  public computeValidatorSetHash(validators: readonly BridgeValidator[]): string {
    const sorted = [...validators].sort((a, b) => a.validatorId.localeCompare(b.validatorId));
    return hashHex(
      'BRIDGE_VALSET',
      sorted.map((v) => `${v.validatorId}:${v.votingPower.toString()}:${v.publicPoint.toString(16)}`)
    );
  }

  public computeHeaderHash(
    epoch: number,
    parentHeaderHash: string,
    stateRoot: string,
    nextValidatorSetHash: string
  ): string {
    return hashHex('BRIDGE_HEADER', [
      String(epoch),
      parentHeaderHash,
      stateRoot,
      nextValidatorSetHash,
    ]);
  }

  public signHeader(
    validator: BridgeValidator,
    headerHash: string,
    nonceSeed: string
  ): ValidatorSignature {
    const k = hashToScalar('BRIDGE_SIG_K', [validator.validatorId, headerHash, nonceSeed]);
    const noncePointR = modPow(SUBGROUP_GEN, k, SAFE_PRIME);
    const e = hashToScalar('BRIDGE_SIG_E', [
      headerHash,
      validator.publicPoint.toString(16),
      noncePointR.toString(16),
    ]);
    const responseS = modQ(k + modQ(e * modQ(validator.witnessScalar)));
    return { validatorId: validator.validatorId, noncePointR, responseS };
  }

  public verifyValidatorSignature(
    publicPoint: bigint,
    headerHash: string,
    sig: ValidatorSignature
  ): boolean {
    const e = hashToScalar('BRIDGE_SIG_E', [
      headerHash,
      publicPoint.toString(16),
      sig.noncePointR.toString(16),
    ]);
    const lhs = modPow(SUBGROUP_GEN, modQ(sig.responseS), SAFE_PRIME);
    const rhs = modP(sig.noncePointR * modPow(publicPoint, e, SAFE_PRIME));
    return lhs === rhs;
  }

  private commitHeader(headerHash: string, stateRoot: string, epoch: number): bigint {
    const m1 = hashToScalar('BRIDGE_HDR_M1', [headerHash, String(epoch)]);
    const m2 = hashToScalar('BRIDGE_HDR_M2', [stateRoot, String(epoch)]);
    return modP(modPow(SUBGROUP_GEN, m1, SAFE_PRIME) * modPow(this.genH, m2, SAFE_PRIME));
  }

  public buildMessageMerkleRoot(
    messages: ReadonlyArray<{ readonly messageId: string; readonly payloadHash: string }>
  ): { root: string; proofs: Map<string, CrossChainMessageProof> } {
    if (messages.length === 0) {
      throw new Error('At least one message is required');
    }
    let size = 1;
    while (size < messages.length) size <<= 1;

    const leafHashes: string[] = [];
    for (let i = 0; i < size; i++) {
      if (i < messages.length) {
        leafHashes.push(hashHex('BRIDGE_MSG_LEAF', [messages[i].messageId, messages[i].payloadHash]));
      } else {
        leafHashes.push(hashHex('BRIDGE_MSG_PAD', [String(i)]));
      }
    }

    const levels: string[][] = [leafHashes];
    let cur = leafHashes;
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashHex('BRIDGE_MSG_NODE', [cur[i], cur[i + 1]]));
      }
      levels.push(next);
      cur = next;
    }

    const root = levels[levels.length - 1][0];
    const proofs = new Map<string, CrossChainMessageProof>();
    for (let i = 0; i < messages.length; i++) {
      const path: BridgeMessageMerkleStep[] = [];
      let idx = i;
      for (let lvl = 0; lvl < levels.length - 1; lvl++) {
        path.push({
          siblingHash: levels[lvl][idx ^ 1],
          isRightSibling: (idx & 1) === 0,
        });
        idx >>= 1;
      }
      proofs.set(messages[i].messageId, {
        messageId: messages[i].messageId,
        payloadHash: messages[i].payloadHash,
        leafHash: leafHashes[i],
        merklePath: path,
      });
    }

    return { root, proofs };
  }

  public verifyMessageInclusion(stateRoot: string, proof: CrossChainMessageProof): boolean {
    const expectedLeaf = hashHex('BRIDGE_MSG_LEAF', [proof.messageId, proof.payloadHash]);
    if (expectedLeaf !== proof.leafHash) return false;
    let cur = expectedLeaf;
    for (const step of proof.merklePath) {
      cur = step.isRightSibling
        ? hashHex('BRIDGE_MSG_NODE', [cur, step.siblingHash])
        : hashHex('BRIDGE_MSG_NODE', [step.siblingHash, cur]);
    }
    return cur === stateRoot;
  }

  public proveEpochChain(
    genesisHash: string,
    epochValidatorSets: readonly (readonly BridgeValidator[])[],
    headers: readonly EpochBridgeHeader[]
  ): RecursiveBridgeProof {
    if (headers.length === 0 || epochValidatorSets.length !== headers.length) {
      throw new Error('Headers and validator sets must be non-empty and match in length');
    }

    const genesisValidatorSetHash = this.computeValidatorSetHash(epochValidatorSets[0]);
    let prevHeaderHash = genesisHash;
    let expectedValSetHash = genesisValidatorSetHash;
    let accumulator = 1n;
    let transcript = hashHex('BRIDGE_REC_INIT', [genesisHash, genesisValidatorSetHash]);

    const steps: RecursiveBridgeStepProof[] = [];

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const validators = epochValidatorSets[i];
      const currentValSetHash = this.computeValidatorSetHash(validators);

      if (currentValSetHash !== expectedValSetHash) {
        throw new Error(`Validator set rotation mismatch at epoch ${header.epoch}`);
      }
      if (header.parentHeaderHash !== prevHeaderHash) {
        throw new Error(`Parent header hash broken at epoch ${header.epoch}`);
      }
      const recomputedHeaderHash = this.computeHeaderHash(
        header.epoch,
        header.parentHeaderHash,
        header.stateRoot,
        header.nextValidatorSetHash
      );
      if (recomputedHeaderHash !== header.headerHash) {
        throw new Error(`Header hash integrity mismatch at epoch ${header.epoch}`);
      }

      const valMap = new Map(validators.map((v) => [v.validatorId, v]));
      let totalPower = 0n;
      for (const v of validators) totalPower += v.votingPower;
      const quorumThreshold = (totalPower * 2n) / 3n + 1n;

      const seen = new Set<string>();
      let signedPower = 0n;
      for (const sig of header.signatures) {
        if (seen.has(sig.validatorId)) continue;
        const val = valMap.get(sig.validatorId);
        if (!val || !this.verifyValidatorSignature(val.publicPoint, header.headerHash, sig)) {
          throw new Error(`Invalid validator signature from ${sig.validatorId} at epoch ${header.epoch}`);
        }
        seen.add(sig.validatorId);
        signedPower += val.votingPower;
      }

      if (signedPower < quorumThreshold) {
        throw new Error(
          `Under-quorum header at epoch ${header.epoch}: signed ${signedPower}, need ${quorumThreshold}`
        );
      }

      const headerCommitment = this.commitHeader(header.headerHash, header.stateRoot, header.epoch);
      const foldingChallenge = hashToScalar('BRIDGE_REC_FOLD', [
        transcript,
        header.headerHash,
        header.stateRoot,
        headerCommitment.toString(16),
      ]);

      accumulator = modP(
        modPow(accumulator, foldingChallenge, SAFE_PRIME) * headerCommitment
      );

      transcript = hashHex('BRIDGE_REC_STEP', [
        transcript,
        String(header.epoch),
        header.headerHash,
        header.stateRoot,
        header.nextValidatorSetHash,
        accumulator.toString(16),
      ]);

      steps.push({
        epoch: header.epoch,
        headerHash: header.headerHash,
        stateRoot: header.stateRoot,
        signedPower,
        totalPower,
        foldingChallenge,
        headerCommitment,
        updatedAccumulator: accumulator,
        transcriptDigest: transcript,
      });

      prevHeaderHash = header.headerHash;
      expectedValSetHash = header.nextValidatorSetHash;
    }

    const last = headers[headers.length - 1];
    return {
      genesisHash,
      genesisValidatorSetHash,
      steps,
      finalEpoch: last.epoch,
      finalStateRoot: last.stateRoot,
      finalAccumulator: accumulator,
      finalTranscriptDigest: transcript,
    };
  }

  public verifyRecursiveBridgeProof(
    proof: RecursiveBridgeProof,
    headers: readonly EpochBridgeHeader[]
  ): BridgeVerificationResult {
    if (proof.steps.length === 0 || proof.steps.length !== headers.length) {
      return {
        isValid: false,
        verifiedEpochs: 0,
        finalStateRoot: '',
        reason: 'Recursive proof step count does not match header chain length',
      };
    }

    let accumulator = 1n;
    let transcript = hashHex('BRIDGE_REC_INIT', [
      proof.genesisHash,
      proof.genesisValidatorSetHash,
    ]);
    let prevHeaderHash = proof.genesisHash;

    for (let i = 0; i < proof.steps.length; i++) {
      const step = proof.steps[i];
      const header = headers[i];

      if (header.parentHeaderHash !== prevHeaderHash) {
        return {
          isValid: false,
          verifiedEpochs: i,
          finalStateRoot: '',
          reason: `Header parent link broken at epoch ${header.epoch}`,
        };
      }
      const expectedHeaderHash = this.computeHeaderHash(
        header.epoch,
        header.parentHeaderHash,
        header.stateRoot,
        header.nextValidatorSetHash
      );
      if (expectedHeaderHash !== header.headerHash || expectedHeaderHash !== step.headerHash) {
        return {
          isValid: false,
          verifiedEpochs: i,
          finalStateRoot: '',
          reason: `Header hash mismatch at epoch ${header.epoch}`,
        };
      }

      const quorumThreshold = (step.totalPower * 2n) / 3n + 1n;
      if (step.signedPower < quorumThreshold) {
        return {
          isValid: false,
          verifiedEpochs: i,
          finalStateRoot: '',
          reason: `Insufficient quorum voting power at epoch ${header.epoch}`,
        };
      }

      const expectedCommit = this.commitHeader(header.headerHash, header.stateRoot, header.epoch);
      if (expectedCommit !== step.headerCommitment) {
        return {
          isValid: false,
          verifiedEpochs: i,
          finalStateRoot: '',
          reason: `Header Pedersen commitment mismatch at epoch ${header.epoch}`,
        };
      }

      const expectedChallenge = hashToScalar('BRIDGE_REC_FOLD', [
        transcript,
        header.headerHash,
        header.stateRoot,
        expectedCommit.toString(16),
      ]);
      if (expectedChallenge !== step.foldingChallenge) {
        return {
          isValid: false,
          verifiedEpochs: i,
          finalStateRoot: '',
          reason: `Recursive folding challenge mismatch at epoch ${header.epoch}`,
        };
      }

      accumulator = modP(modPow(accumulator, expectedChallenge, SAFE_PRIME) * expectedCommit);
      transcript = hashHex('BRIDGE_REC_STEP', [
        transcript,
        String(header.epoch),
        header.headerHash,
        header.stateRoot,
        header.nextValidatorSetHash,
        accumulator.toString(16),
      ]);

      if (accumulator !== step.updatedAccumulator || transcript !== step.transcriptDigest) {
        return {
          isValid: false,
          verifiedEpochs: i,
          finalStateRoot: '',
          reason: `Recursive accumulator or transcript mismatch at epoch ${header.epoch}`,
        };
      }

      prevHeaderHash = header.headerHash;
    }

    const lastHeader = headers[headers.length - 1];
    if (
      accumulator !== proof.finalAccumulator ||
      transcript !== proof.finalTranscriptDigest ||
      lastHeader.stateRoot !== proof.finalStateRoot ||
      lastHeader.epoch !== proof.finalEpoch
    ) {
      return {
        isValid: false,
        verifiedEpochs: proof.steps.length,
        finalStateRoot: '',
        reason: 'Final recursive bridge state or accumulator mismatch',
      };
    }

    return {
      isValid: true,
      verifiedEpochs: proof.steps.length,
      finalStateRoot: proof.finalStateRoot,
    };
  }
}
