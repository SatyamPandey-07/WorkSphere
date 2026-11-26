import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Social-Recovery Threshold Guardian Wallet Escrow Prover.
 *
 * Implements a timelocked social-recovery smart wallet protocol backed by (t, n) guardian
 * Schnorr attestations and an owner veto/cancellation mechanism:
 *  - Wallet owner configures a guardian set G = [g_1..g_n], threshold t, and timelock delay D.
 *  - If the owner loses their active key, >= t guardians sign a RecoveryProposal nominating
 *    a new owner public key pk_new effective after (initiatedBlock + D).
 *  - During the timelock window [initiatedBlock, initiatedBlock + D), the original owner can
 *    broadcast a signed OwnerVetoCertificate to immediately cancel a hijacked recovery!
 *  - After block >= initiatedBlock + D with no valid owner veto, anyone can finalize and
 *    verify the rotated owner key certificate!
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

export interface WalletKeyPair {
  id: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface GuardianWalletPolicy {
  walletId: string;
  currentOwnerPubKey: bigint;
  guardians: Array<{ guardianId: string; publicKey: bigint }>;
  threshold: number;
  timelockDelayBlocks: number;
  recoveryNonce: number;
}

export interface GuardianApprovalSig {
  guardianId: string;
  sigR: bigint;
  sigS: bigint;
}

export interface RecoveryProposal {
  walletId: string;
  recoveryNonce: number;
  proposedOwnerPubKey: bigint;
  initiatedBlock: number;
  executableBlock: number;
  proposalDigest: string;
  approvals: GuardianApprovalSig[];
}

export interface OwnerVetoCertificate {
  walletId: string;
  proposalDigest: string;
  vetoBlock: number;
  ownerSigR: bigint;
  ownerSigS: bigint;
}

export interface RecoveryResolutionResult {
  status: 'FINALIZED' | 'VETOED' | 'PENDING_TIMELOCK' | 'INVALID';
  newOwnerPubKey?: bigint;
  reason: string;
}

export class VerifiableThresholdKeyRecoveryEscrow {
  public generateKeyPair(id: string): WalletKeyPair {
    const secretKey = randomScalar();
    return { id, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  public createWalletPolicy(
    walletId: string,
    ownerPubKey: bigint,
    guardians: Array<Pick<WalletKeyPair, 'id' | 'publicKey'>>,
    threshold: number,
    timelockDelayBlocks: number,
  ): GuardianWalletPolicy {
    if (threshold < 1 || threshold > guardians.length) throw new RangeError('Invalid guardian threshold');
    if (timelockDelayBlocks < 1) throw new RangeError('Timelock delay must be >= 1 block');
    const ids = new Set(guardians.map((g) => g.id));
    if (ids.size !== guardians.length) throw new Error('Duplicate guardian IDs');
    return {
      walletId,
      currentOwnerPubKey: ownerPubKey,
      guardians: guardians.map((g) => ({ guardianId: g.id, publicKey: g.publicKey })),
      threshold,
      timelockDelayBlocks,
      recoveryNonce: 0,
    };
  }

  private sign(kp: WalletKeyPair, domain: string, digest: string): { sigR: bigint; sigS: bigint } {
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar(domain, sigR.toString(16), kp.publicKey.toString(16), digest);
    return { sigR, sigS: modScalar(k + c * kp.secretKey) };
  }

  private verifySig(pubKey: bigint, domain: string, digest: string, sigR: bigint, sigS: bigint): boolean {
    const c = hashToScalar(domain, sigR.toString(16), pubKey.toString(16), digest);
    return modPow(BASE_G, sigS, SAFE_PRIME_P) === (sigR * modPow(pubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public computeProposalDigest(
    walletId: string,
    recoveryNonce: number,
    proposedOwnerPubKey: bigint,
    initiatedBlock: number,
    executableBlock: number,
  ): string {
    return sha256Hex(
      'WALLET-RECOVERY-V1',
      walletId,
      String(recoveryNonce),
      proposedOwnerPubKey.toString(16),
      String(initiatedBlock),
      String(executableBlock),
    );
  }

  public initiateRecovery(
    policy: GuardianWalletPolicy,
    proposedOwnerPubKey: bigint,
    initiatedBlock: number,
    approvingGuardians: WalletKeyPair[],
  ): { proposal: RecoveryProposal | null; rejectedGuardianIds: string[] } {
    if (proposedOwnerPubKey === policy.currentOwnerPubKey) {
      throw new Error('Proposed owner key must differ from current owner key');
    }
    const executableBlock = initiatedBlock + policy.timelockDelayBlocks;
    const proposalDigest = this.computeProposalDigest(
      policy.walletId,
      policy.recoveryNonce,
      proposedOwnerPubKey,
      initiatedBlock,
      executableBlock,
    );

    const gMap = new Map(policy.guardians.map((g) => [g.guardianId, g.publicKey]));
    const seen = new Set<string>();
    const approvals: GuardianApprovalSig[] = [];
    const rejectedGuardianIds: string[] = [];

    for (const g of approvingGuardians) {
      const regPub = gMap.get(g.id);
      if (!regPub || regPub !== g.publicKey || seen.has(g.id)) {
        rejectedGuardianIds.push(g.id);
        continue;
      }
      seen.add(g.id);
      const sig = this.sign(g, 'RECOVERY-GUARDIAN-SIG', proposalDigest);
      approvals.push({ guardianId: g.id, ...sig });
    }

    if (approvals.length < policy.threshold) {
      return { proposal: null, rejectedGuardianIds };
    }

    return {
      proposal: {
        walletId: policy.walletId,
        recoveryNonce: policy.recoveryNonce,
        proposedOwnerPubKey,
        initiatedBlock,
        executableBlock,
        proposalDigest,
        approvals,
      },
      rejectedGuardianIds,
    };
  }

  public verifyProposal(policy: GuardianWalletPolicy, proposal: RecoveryProposal): boolean {
    if (
      proposal.walletId !== policy.walletId ||
      proposal.recoveryNonce !== policy.recoveryNonce ||
      proposal.executableBlock !== proposal.initiatedBlock + policy.timelockDelayBlocks
    ) {
      return false;
    }

    const expectedDigest = this.computeProposalDigest(
      proposal.walletId,
      proposal.recoveryNonce,
      proposal.proposedOwnerPubKey,
      proposal.initiatedBlock,
      proposal.executableBlock,
    );
    if (expectedDigest !== proposal.proposalDigest) return false;

    const gMap = new Map(policy.guardians.map((g) => [g.guardianId, g.publicKey]));
    const seen = new Set<string>();
    for (const app of proposal.approvals) {
      const pub = gMap.get(app.guardianId);
      if (!pub || seen.has(app.guardianId)) return false;
      if (!this.verifySig(pub, 'RECOVERY-GUARDIAN-SIG', proposal.proposalDigest, app.sigR, app.sigS)) return false;
      seen.add(app.guardianId);
    }
    return seen.size >= policy.threshold;
  }

  public createOwnerVeto(owner: WalletKeyPair, proposal: RecoveryProposal, vetoBlock: number): OwnerVetoCertificate {
    const vetoDigest = sha256Hex('RECOVERY-VETO-V1', proposal.walletId, proposal.proposalDigest, String(vetoBlock));
    const { sigR: ownerSigR, sigS: ownerSigS } = this.sign(owner, 'RECOVERY-OWNER-VETO', vetoDigest);
    return { walletId: proposal.walletId, proposalDigest: proposal.proposalDigest, vetoBlock, ownerSigR, ownerSigS };
  }

  public verifyOwnerVeto(policy: GuardianWalletPolicy, proposal: RecoveryProposal, veto: OwnerVetoCertificate): boolean {
    if (veto.walletId !== policy.walletId || veto.proposalDigest !== proposal.proposalDigest) return false;
    if (veto.vetoBlock < proposal.initiatedBlock || veto.vetoBlock >= proposal.executableBlock) return false;
    const vetoDigest = sha256Hex('RECOVERY-VETO-V1', veto.walletId, veto.proposalDigest, String(veto.vetoBlock));
    return this.verifySig(policy.currentOwnerPubKey, 'RECOVERY-OWNER-VETO', vetoDigest, veto.ownerSigR, veto.ownerSigS);
  }

  public resolveRecovery(
    policy: GuardianWalletPolicy,
    proposal: RecoveryProposal,
    currentBlock: number,
    ownerVeto?: OwnerVetoCertificate,
  ): RecoveryResolutionResult {
    if (!this.verifyProposal(policy, proposal)) {
      return { status: 'INVALID', reason: 'Recovery proposal failed guardian threshold verification' };
    }
    if (ownerVeto && this.verifyOwnerVeto(policy, proposal, ownerVeto)) {
      return { status: 'VETOED', reason: `Recovery cancelled by active owner veto at block ${ownerVeto.vetoBlock}` };
    }
    if (currentBlock < proposal.executableBlock) {
      return {
        status: 'PENDING_TIMELOCK',
        reason: `Timelock active until block ${proposal.executableBlock} (current=${currentBlock})`,
      };
    }
    return {
      status: 'FINALIZED',
      newOwnerPubKey: proposal.proposedOwnerPubKey,
      reason: `Ownership rotated to new key at block ${currentBlock}`,
    };
  }

  public serializeProposal(p: RecoveryProposal): string {
    return JSON.stringify({
      walletId: p.walletId,
      recoveryNonce: p.recoveryNonce,
      executableBlock: p.executableBlock,
      approvalCount: p.approvals.length,
    });
  }
}
