import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Cross-Chain PoS Light-Client Header Relay & Event Inclusion Prover.
 *
 * Enables a destination chain light client to verify cross-chain bridge messages from a
 * source Proof-of-Stake chain WITHOUT running a full node:
 *  - Source chain validators hold stake-weighted Schnorr keys with supermajority quorum >= 2/3 + 1
 *  - Each block header binds (sourceChainId, height, parentHash, stateRoot, eventsMerkleRoot)
 *    and carries a quorum of validator signatures
 *  - Light-client relay verifies a contiguous sequence of signed headers anchored to a trusted
 *    checkpoint height, advances its finalized tip, and verifies Merkle event inclusion proofs
 *    for cross-chain bridge lock/burn messages against any finalized header's eventsMerkleRoot!
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

export interface BridgeValidatorPublic {
  validatorId: string;
  stake: bigint;
  publicKey: bigint;
}

export interface BridgeValidatorSigner extends BridgeValidatorPublic {
  secretKey: bigint;
}

export interface BridgeEventMessage {
  nonce: number;
  srcChainId: string;
  dstChainId: string;
  sender: string;
  recipient: string;
  amount: bigint;
}

export interface SignedRelayHeader {
  chainId: string;
  height: number;
  parentHash: string;
  stateRoot: string;
  eventsMerkleRoot: string;
  headerHash: string;
  signatures: Array<{ validatorId: string; sigR: bigint; sigS: bigint }>;
}

export interface CrossChainEventProof {
  header: SignedRelayHeader;
  eventIndex: number;
  event: BridgeEventMessage;
  merklePath: Array<{ direction: 'left' | 'right'; hash: string }>;
}

export class VerifiableCrossChainLightHeaderRelay {
  public readonly sourceChainId: string;
  private validators = new Map<string, BridgeValidatorPublic>();
  private finalizedHeaders = new Map<number, SignedRelayHeader>();
  private processedEventNonces = new Set<number>();

  constructor(sourceChainId: string) {
    this.sourceChainId = sourceChainId;
  }

  public registerValidator(validatorId: string, stake: bigint): BridgeValidatorSigner {
    if (this.validators.has(validatorId)) throw new Error(`Validator "${validatorId}" already exists`);
    if (stake <= 0n) throw new RangeError('Stake must be positive');
    const secretKey = randomScalar();
    const publicKey = modPow(BASE_G, secretKey, SAFE_PRIME_P);
    const pub: BridgeValidatorPublic = { validatorId, stake, publicKey };
    this.validators.set(validatorId, pub);
    return { ...pub, secretKey };
  }

  public getQuorumStake(): bigint {
    let total = 0n;
    for (const v of this.validators.values()) total += v.stake;
    return (total * 2n) / 3n + 1n;
  }

  public hashBridgeEvent(ev: BridgeEventMessage): string {
    return sha256Hex(
      'BRIDGE-EVENT-V1',
      String(ev.nonce),
      ev.srcChainId,
      ev.dstChainId,
      ev.sender,
      ev.recipient,
      ev.amount.toString(),
    );
  }

  public buildEventsMerkle(events: BridgeEventMessage[]): { root: string; levels: string[][] } {
    if (events.length === 0) {
      const empty = sha256Hex('BRIDGE-EMPTY-EVENTS');
      return { root: empty, levels: [[empty]] };
    }
    const levels: string[][] = [events.map((e, i) => sha256Hex('BRIDGE-EV-LEAF', String(i), this.hashBridgeEvent(e)))];
    let cur = levels[0];
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(sha256Hex('BRIDGE-EV-NODE', cur[i], i + 1 < cur.length ? cur[i + 1] : cur[i]));
      }
      levels.push(next);
      cur = next;
    }
    return { root: cur[0], levels };
  }

  public computeHeaderHash(height: number, parentHash: string, stateRoot: string, eventsMerkleRoot: string): string {
    return sha256Hex('RELAY-HEADER-V1', this.sourceChainId, String(height), parentHash, stateRoot, eventsMerkleRoot);
  }

  private signHeader(val: BridgeValidatorSigner, headerHash: string): { validatorId: string; sigR: bigint; sigS: bigint } {
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('RELAY-HDR-SIG-V1', sigR.toString(16), val.publicKey.toString(16), headerHash);
    return { validatorId: val.validatorId, sigR, sigS: modScalar(k + c * val.secretKey) };
  }

  private verifyHeaderSig(pubKey: bigint, headerHash: string, sigR: bigint, sigS: bigint): boolean {
    const c = hashToScalar('RELAY-HDR-SIG-V1', sigR.toString(16), pubKey.toString(16), headerHash);
    return modPow(BASE_G, sigS, SAFE_PRIME_P) === (sigR * modPow(pubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public produceSignedHeader(params: {
    height: number;
    parentHash: string;
    stateRoot: string;
    events: BridgeEventMessage[];
    signers: BridgeValidatorSigner[];
  }): { header: SignedRelayHeader; eventsLevels: string[][] } {
    const { root: eventsMerkleRoot, levels: eventsLevels } = this.buildEventsMerkle(params.events);
    const headerHash = this.computeHeaderHash(params.height, params.parentHash, params.stateRoot, eventsMerkleRoot);
    const signatures = params.signers.map((s) => this.signHeader(s, headerHash));
    return {
      header: {
        chainId: this.sourceChainId,
        height: params.height,
        parentHash: params.parentHash,
        stateRoot: params.stateRoot,
        eventsMerkleRoot,
        headerHash,
        signatures,
      },
      eventsLevels,
    };
  }

  public verifySignedHeader(header: SignedRelayHeader): boolean {
    if (header.chainId !== this.sourceChainId || header.height < 0) return false;
    const expectedHash = this.computeHeaderHash(header.height, header.parentHash, header.stateRoot, header.eventsMerkleRoot);
    if (expectedHash !== header.headerHash) return false;

    const seen = new Set<string>();
    let signedStake = 0n;
    for (const sig of header.signatures) {
      const rec = this.validators.get(sig.validatorId);
      if (!rec || seen.has(sig.validatorId)) return false;
      if (!this.verifyHeaderSig(rec.publicKey, header.headerHash, sig.sigR, sig.sigS)) return false;
      seen.add(sig.validatorId);
      signedStake += rec.stake;
    }
    return signedStake >= this.getQuorumStake();
  }

  public initializeTrustedAnchor(anchorHeader: SignedRelayHeader): void {
    if (!this.verifySignedHeader(anchorHeader)) {
      throw new Error('Trusted anchor header failed quorum signature verification');
    }
    this.finalizedHeaders.set(anchorHeader.height, anchorHeader);
  }

  public relayHeaderChain(headers: SignedRelayHeader[]): { acceptedCount: number; latestHeight: number; rejectedAtHeight?: number } {
    let acceptedCount = 0;
    let latestHeight = Math.max(-1, ...this.finalizedHeaders.keys());

    for (const h of headers) {
      const parent = this.finalizedHeaders.get(h.height - 1);
      if (!parent || h.parentHash !== parent.headerHash || !this.verifySignedHeader(h)) {
        return { acceptedCount, latestHeight, rejectedAtHeight: h.height };
      }
      this.finalizedHeaders.set(h.height, h);
      acceptedCount++;
      if (h.height > latestHeight) latestHeight = h.height;
    }

    return { acceptedCount, latestHeight };
  }

  public buildEventProof(header: SignedRelayHeader, events: BridgeEventMessage[], eventIndex: number): CrossChainEventProof {
    if (eventIndex < 0 || eventIndex >= events.length) throw new RangeError('Event index out of bounds');
    const { levels } = this.buildEventsMerkle(events);
    const merklePath: Array<{ direction: 'left' | 'right'; hash: string }> = [];
    let pos = eventIndex;
    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const arr = levels[lvl];
      const isRight = pos % 2 === 1;
      const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
      merklePath.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
      pos >>= 1;
    }
    return { header, eventIndex, event: events[eventIndex], merklePath };
  }

  public verifyAndExecuteEvent(proof: CrossChainEventProof): { executed: boolean; replayDetected: boolean; reason?: string } {
    const finalized = this.finalizedHeaders.get(proof.header.height);
    if (!finalized || finalized.headerHash !== proof.header.headerHash) {
      return { executed: false, replayDetected: false, reason: 'Header not finalized in light client' };
    }
    if (proof.event.srcChainId !== this.sourceChainId) {
      return { executed: false, replayDetected: false, reason: 'Source chain ID mismatch' };
    }

    let cur = sha256Hex('BRIDGE-EV-LEAF', String(proof.eventIndex), this.hashBridgeEvent(proof.event));
    for (const step of proof.merklePath) {
      cur = step.direction === 'left'
        ? sha256Hex('BRIDGE-EV-NODE', step.hash, cur)
        : sha256Hex('BRIDGE-EV-NODE', cur, step.hash);
    }
    if (cur !== finalized.eventsMerkleRoot) {
      return { executed: false, replayDetected: false, reason: 'Event Merkle inclusion proof failed' };
    }

    if (this.processedEventNonces.has(proof.event.nonce)) {
      return { executed: false, replayDetected: true, reason: `Bridge event nonce ${proof.event.nonce} already executed` };
    }
    this.processedEventNonces.add(proof.event.nonce);
    return { executed: true, replayDetected: false };
  }

  public serializeHeader(h: SignedRelayHeader): string {
    return JSON.stringify({
      chainId: h.chainId,
      height: h.height,
      headerHash: h.headerHash,
      signerCount: h.signatures.length,
    });
  }
}
