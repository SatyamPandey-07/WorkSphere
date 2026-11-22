import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Optimistic Rollup Interactive Fraud Bisection Prover (Arbitrum-style).
 *
 * Resolves disputes over an N-step off-chain rollup execution trace in O(log N) bisection
 * rounds down to a SINGLE disputed 1-step state transition verified directly on-chain:
 *  - Deterministic state machine transition function step(stateHash, instruction) -> nextStateHash
 *  - Asserter claims initial state S_0 evolves to S_N after executing instructions [op_0..op_{N-1}]
 *  - Challenger disagrees on S_N -> binary-search bisection protocol iteratively splits [lo, hi]
 *    at mid = floor((lo + hi) / 2), exchanging Schnorr-signed midpoint assertions until hi == lo + 1!
 *  - On-chain adjudicator verifies EVERY signed bisection step in the transcript AND executes
 *    ONLY the single disputed instruction op_{lo} to mathematically identify & slash the liar!
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

export interface RollupPartyKeys {
  partyId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface RollupInstruction {
  stepIndex: number;
  opcode: 'ADD' | 'MUL' | 'XOR_HASH' | 'TRANSFER';
  operand: string;
}

export interface BisectionRoundRecord {
  round: number;
  lo: number;
  hi: number;
  mid: number;
  asserterMidState: string;
  challengerMidState: string;
  chosenHalf: 'LEFT' | 'RIGHT';
  asserterSigR: bigint;
  asserterSigS: bigint;
  challengerSigR: bigint;
  challengerSigS: bigint;
}

export interface OneStepDisputeTranscript {
  disputeId: string;
  initialStateHash: string;
  asserterFinalState: string;
  challengerFinalState: string;
  asserterPubKey: bigint;
  challengerPubKey: bigint;
  totalSteps: number;
  rounds: BisectionRoundRecord[];
  disputedStepIndex: number;
  agreedPreState: string;
  asserterPostState: string;
  challengerPostState: string;
  disputedInstruction: RollupInstruction;
}

export interface AdjudicationVerdict {
  transcriptValid: boolean;
  winner: 'ASSERTER' | 'CHALLENGER' | 'INVALID';
  slashedParty: 'ASSERTER' | 'CHALLENGER' | 'NONE';
  disputedStepIndex: number;
  computedTruePostState: string;
  bisectionRounds: number;
  reason: string;
}

export class VerifiableRollupFraudBisectionProver {
  public generateParty(partyId: string): RollupPartyKeys {
    const secretKey = randomScalar();
    return { partyId, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  public executeOneStep(stateHash: string, instr: RollupInstruction): string {
    return sha256Hex('ROLLUP-VM-STEP-V1', stateHash, String(instr.stepIndex), instr.opcode, instr.operand);
  }

  public computeFullTrace(initialStateHash: string, instructions: RollupInstruction[]): string[] {
    const trace = [initialStateHash];
    let cur = initialStateHash;
    for (let i = 0; i < instructions.length; i++) {
      if (instructions[i].stepIndex !== i) {
        throw new Error(`Instruction stepIndex mismatch at ${i}`);
      }
      cur = this.executeOneStep(cur, instructions[i]);
      trace.push(cur);
    }
    return trace;
  }

  /**
   * Produces a corrupted trace diverging starting at `faultStep` (simulating a fraudulent sequencer).
   */
  public computeCorruptedTrace(
    initialStateHash: string,
    instructions: RollupInstruction[],
    faultStep: number,
  ): string[] {
    if (faultStep < 0 || faultStep >= instructions.length) {
      throw new RangeError('faultStep out of instruction bounds');
    }
    const trace = [initialStateHash];
    let cur = initialStateHash;
    for (let i = 0; i < instructions.length; i++) {
      cur = this.executeOneStep(cur, instructions[i]);
      if (i === faultStep) {
        cur = sha256Hex('FRAUD-INJECT-V1', cur);
      }
      trace.push(cur);
    }
    return trace;
  }

  private sign(party: RollupPartyKeys, msg: string): { sigR: bigint; sigS: bigint } {
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('BISECT-SIG-V1', sigR.toString(16), party.publicKey.toString(16), msg);
    return { sigR, sigS: modScalar(k + c * party.secretKey) };
  }

  private verifySig(pubKey: bigint, msg: string, sigR: bigint, sigS: bigint): boolean {
    const c = hashToScalar('BISECT-SIG-V1', sigR.toString(16), pubKey.toString(16), msg);
    return modPow(BASE_G, sigS, SAFE_PRIME_P) === (sigR * modPow(pubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private roundDigest(
    disputeId: string,
    round: number,
    lo: number,
    hi: number,
    mid: number,
    stateHash: string,
  ): string {
    return sha256Hex('BISECT-ROUND-V1', disputeId, String(round), String(lo), String(hi), String(mid), stateHash);
  }

  public runInteractiveBisection(
    disputeId: string,
    instructions: RollupInstruction[],
    asserter: RollupPartyKeys,
    asserterTrace: string[],
    challenger: RollupPartyKeys,
    challengerTrace: string[],
  ): OneStepDisputeTranscript {
    const totalSteps = instructions.length;
    if (totalSteps < 1) throw new Error('Instruction list cannot be empty');
    if (asserterTrace.length !== totalSteps + 1 || challengerTrace.length !== totalSteps + 1) {
      throw new Error('Trace lengths must equal instructions.length + 1');
    }
    if (asserterTrace[0] !== challengerTrace[0]) {
      throw new Error('Both parties must agree on initialStateHash');
    }
    if (asserterTrace[totalSteps] === challengerTrace[totalSteps]) {
      throw new Error('No dispute: both parties agree on final state');
    }

    let lo = 0;
    let hi = totalSteps;
    const rounds: BisectionRoundRecord[] = [];
    let roundNum = 0;

    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const asserterMidState = asserterTrace[mid];
      const challengerMidState = challengerTrace[mid];

      // If parties AGREE at midpoint -> divergence is in RIGHT half [mid, hi];
      // if they DISAGREE at midpoint -> divergence is in LEFT half [lo, mid]!
      const chosenHalf: 'LEFT' | 'RIGHT' = asserterMidState === challengerMidState ? 'RIGHT' : 'LEFT';

      const aSig = this.sign(asserter, this.roundDigest(disputeId, roundNum, lo, hi, mid, asserterMidState));
      const cSig = this.sign(challenger, this.roundDigest(disputeId, roundNum, lo, hi, mid, challengerMidState));

      rounds.push({
        round: roundNum,
        lo,
        hi,
        mid,
        asserterMidState,
        challengerMidState,
        chosenHalf,
        asserterSigR: aSig.sigR,
        asserterSigS: aSig.sigS,
        challengerSigR: cSig.sigR,
        challengerSigS: cSig.sigS,
      });

      if (chosenHalf === 'RIGHT') lo = mid;
      else hi = mid;
      roundNum++;
    }

    return {
      disputeId,
      initialStateHash: asserterTrace[0],
      asserterFinalState: asserterTrace[totalSteps],
      challengerFinalState: challengerTrace[totalSteps],
      asserterPubKey: asserter.publicKey,
      challengerPubKey: challenger.publicKey,
      totalSteps,
      rounds,
      disputedStepIndex: lo,
      agreedPreState: asserterTrace[lo],
      asserterPostState: asserterTrace[lo + 1],
      challengerPostState: challengerTrace[lo + 1],
      disputedInstruction: instructions[lo],
    };
  }

  public adjudicateOnChain(transcript: OneStepDisputeTranscript): AdjudicationVerdict {
    if (transcript.totalSteps < 1 || transcript.asserterFinalState === transcript.challengerFinalState) {
      return {
        transcriptValid: false,
        winner: 'INVALID',
        slashedParty: 'NONE',
        disputedStepIndex: -1,
        computedTruePostState: '',
        bisectionRounds: transcript.rounds.length,
        reason: 'Invalid initial dispute parameters',
      };
    }

    // Verify every bisection round's bounds, signatures, and state continuity
    let lo = 0;
    let hi = transcript.totalSteps;
    let agreedLoState = transcript.initialStateHash;
    let asserterHiState = transcript.asserterFinalState;
    let challengerHiState = transcript.challengerFinalState;

    for (let i = 0; i < transcript.rounds.length; i++) {
      const r = transcript.rounds[i];
      const expectedMid = (lo + hi) >> 1;
      if (r.round !== i || r.lo !== lo || r.hi !== hi || r.mid !== expectedMid) {
        return {
          transcriptValid: false,
          winner: 'INVALID',
          slashedParty: 'NONE',
          disputedStepIndex: -1,
          computedTruePostState: '',
          bisectionRounds: transcript.rounds.length,
          reason: `Bisection interval mismatch at round ${i}`,
        };
      }

      const aMsg = this.roundDigest(transcript.disputeId, i, lo, hi, expectedMid, r.asserterMidState);
      const cMsg = this.roundDigest(transcript.disputeId, i, lo, hi, expectedMid, r.challengerMidState);
      if (
        !this.verifySig(transcript.asserterPubKey, aMsg, r.asserterSigR, r.asserterSigS) ||
        !this.verifySig(transcript.challengerPubKey, cMsg, r.challengerSigR, r.challengerSigS)
      ) {
        return {
          transcriptValid: false,
          winner: 'INVALID',
          slashedParty: 'NONE',
          disputedStepIndex: -1,
          computedTruePostState: '',
          bisectionRounds: transcript.rounds.length,
          reason: `Invalid party signature at bisection round ${i}`,
        };
      }

      const expectedHalf: 'LEFT' | 'RIGHT' = r.asserterMidState === r.challengerMidState ? 'RIGHT' : 'LEFT';
      if (r.chosenHalf !== expectedHalf) {
        return {
          transcriptValid: false,
          winner: 'INVALID',
          slashedParty: 'NONE',
          disputedStepIndex: -1,
          computedTruePostState: '',
          bisectionRounds: transcript.rounds.length,
          reason: `Wrong bisection branch selected at round ${i}`,
        };
      }

      if (expectedHalf === 'RIGHT') {
        lo = expectedMid;
        agreedLoState = r.asserterMidState;
      } else {
        hi = expectedMid;
        asserterHiState = r.asserterMidState;
        challengerHiState = r.challengerMidState;
      }
    }

    if (
      hi - lo !== 1 ||
      transcript.disputedStepIndex !== lo ||
      transcript.agreedPreState !== agreedLoState ||
      transcript.asserterPostState !== asserterHiState ||
      transcript.challengerPostState !== challengerHiState ||
      transcript.disputedInstruction.stepIndex !== lo
    ) {
      return {
        transcriptValid: false,
        winner: 'INVALID',
        slashedParty: 'NONE',
        disputedStepIndex: lo,
        computedTruePostState: '',
        bisectionRounds: transcript.rounds.length,
        reason: 'Bisection did not converge to valid single-step dispute boundary',
      };
    }

    // Execute ONLY ONE step on-chain!
    const computedTruePostState = this.executeOneStep(transcript.agreedPreState, transcript.disputedInstruction);
    if (computedTruePostState === transcript.asserterPostState) {
      return {
        transcriptValid: true,
        winner: 'ASSERTER',
        slashedParty: 'CHALLENGER',
        disputedStepIndex: lo,
        computedTruePostState,
        bisectionRounds: transcript.rounds.length,
        reason: `Asserter verified honest at step ${lo}; false challenger slashed`,
      };
    }
    if (computedTruePostState === transcript.challengerPostState) {
      return {
        transcriptValid: true,
        winner: 'CHALLENGER',
        slashedParty: 'ASSERTER',
        disputedStepIndex: lo,
        computedTruePostState,
        bisectionRounds: transcript.rounds.length,
        reason: `Fraud proven at step ${lo}; malicious asserter slashed`,
      };
    }
    return {
      transcriptValid: true,
      winner: 'INVALID',
      slashedParty: 'ASSERTER',
      disputedStepIndex: lo,
      computedTruePostState,
      bisectionRounds: transcript.rounds.length,
      reason: `Neither party matched true post-state at step ${lo}`,
    };
  }

  public serializeTranscript(t: OneStepDisputeTranscript): string {
    return JSON.stringify({
      disputeId: t.disputeId,
      totalSteps: t.totalSteps,
      bisectionRounds: t.rounds.length,
      disputedStepIndex: t.disputedStepIndex,
    });
  }
}
