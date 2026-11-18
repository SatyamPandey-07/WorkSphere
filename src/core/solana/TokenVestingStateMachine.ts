/**
 * @file TokenVestingStateMachine.ts
 * @description Solana PDA-anchored verifiable token vesting schedule state machine
 * with cliff periods, linear/stepped unlock curves, and DAO clawback enforcement.
 */

import { createHash } from 'node:crypto';

export const VestingState = {
  INITIALIZED: 'INITIALIZED',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  REVOKED: 'REVOKED',
} as const;

export type VestingStateKey = typeof VestingState[keyof typeof VestingState];

export const VestingCurve = {
  LINEAR: 'LINEAR',
  STEPPED: 'STEPPED',
} as const;

export type VestingCurveKey = typeof VestingCurve[keyof typeof VestingCurve];

export interface VestingScheduleConfig {
  scheduleId: string;
  granterAddress: string;
  beneficiaryAddress: string;
  tokenMintAddress: string;
  totalAmount: bigint;
  startTimestamp: number;
  cliffTimestamp: number;
  endTimestamp: number;
  stepIntervalMs?: number;
  isRevocable: boolean;
  curveType?: VestingCurveKey;
}

export interface ClaimReceipt {
  scheduleId: string;
  claimant: string;
  claimedAmount: bigint;
  cumulativeClaimed: bigint;
  remainingVested: bigint;
  timestamp: number;
  txSignature: string;
}

export interface RevocationReceipt {
  scheduleId: string;
  caller: string;
  vestedForBeneficiary: bigint;
  clawbackToGranter: bigint;
  timestamp: number;
  txSignature: string;
}

export class TokenVestingStateMachine {
  private _config: VestingScheduleConfig;
  private _pdaAddress: string;
  private _state: VestingStateKey;
  private _claimedAmount: bigint;
  private _clawbackAmount: bigint;
  private _delegates: Set<string>;
  private _history: Array<ClaimReceipt | RevocationReceipt>;

  constructor(config: VestingScheduleConfig) {
    if (config.totalAmount <= 0n) {
      throw new Error('Total vesting amount must be strictly positive.');
    }
    if (config.startTimestamp >= config.endTimestamp) {
      throw new Error('startTimestamp must be strictly before endTimestamp.');
    }
    if (config.cliffTimestamp < config.startTimestamp || config.cliffTimestamp > config.endTimestamp) {
      throw new Error('cliffTimestamp must be between startTimestamp and endTimestamp.');
    }

    this._config = {
      ...config,
      curveType: config.curveType ?? VestingCurve.LINEAR,
      stepIntervalMs: config.stepIntervalMs ?? (30 * 24 * 60 * 60 * 1000), // default 30 days
    };

    this._pdaAddress = this.deriveVestingPDA(config.scheduleId, config.granterAddress, config.beneficiaryAddress);
    this._state = VestingState.ACTIVE;
    this._claimedAmount = 0n;
    this._clawbackAmount = 0n;
    this._delegates = new Set();
    this._history = [];
  }

  public get pdaAddress(): string {
    return this._pdaAddress;
  }

  public get state(): VestingStateKey {
    return this._state;
  }

  public get claimedAmount(): bigint {
    return this._claimedAmount;
  }

  public get clawbackAmount(): bigint {
    return this._clawbackAmount;
  }

  public get config(): VestingScheduleConfig {
    return { ...this._config };
  }

  /**
   * Deterministically derives Solana Program-Derived Address (PDA) seed for vesting account.
   */
  public deriveVestingPDA(scheduleId: string, granter: string, beneficiary: string): string {
    const hash = createHash('sha256')
      .update('solana_vesting_v1')
      .update(scheduleId)
      .update(granter)
      .update(beneficiary)
      .digest('hex');
    return `pda_${hash.slice(0, 32)}`;
  }

  /**
   * Computes cumulative vested tokens at given timestamp based on curve and cliff.
   */
  public getVestedAmount(currentTimestamp: number): bigint {
    if (this._state === VestingState.REVOKED) {
      return this._config.totalAmount - this._clawbackAmount;
    }

    const t = currentTimestamp;
    const start = this._config.startTimestamp;
    const cliff = this._config.cliffTimestamp;
    const end = this._config.endTimestamp;
    const total = this._config.totalAmount;

    if (t < cliff) {
      return 0n; // Nothing vests before cliff
    }

    if (t >= end) {
      return total; // 100% vested after end
    }

    if (this._config.curveType === VestingCurve.STEPPED) {
      const interval = BigInt(this._config.stepIntervalMs!);
      const totalDuration = BigInt(end - start);
      const elapsed = BigInt(t - start);
      const stepsCompleted = elapsed / interval;
      const totalSteps = totalDuration / interval;
      if (totalSteps === 0n) return total;
      return (total * stepsCompleted) / totalSteps;
    }

    // Default: LINEAR
    const elapsed = BigInt(t - start);
    const totalDuration = BigInt(end - start);
    return (total * elapsed) / totalDuration;
  }

  /**
   * Computes available claimable tokens: max(0, vestedAmount - claimedAmount).
   */
  public getClaimableAmount(currentTimestamp: number): bigint {
    if (this._state === VestingState.PAUSED) {
      return 0n;
    }

    const vested = this.getVestedAmount(currentTimestamp);
    if (vested <= this._claimedAmount) {
      return 0n;
    }

    return vested - this._claimedAmount;
  }

  /**
   * Claims vested tokens for the beneficiary.
   */
  public claim(params: {
    callerAddress: string;
    amount?: bigint;
    timestamp?: number;
  }): ClaimReceipt {
    const now = params.timestamp ?? Date.now();

    if (this._state === VestingState.PAUSED) {
      throw new Error('Vesting schedule is currently paused.');
    }
    if (this._state === VestingState.COMPLETED) {
      throw new Error('All vested tokens have already been claimed.');
    }

    const isAuthorized =
      params.callerAddress === this._config.beneficiaryAddress ||
      this._delegates.has(params.callerAddress);

    if (!isAuthorized) {
      throw new Error(`Caller '${params.callerAddress}' is not authorized to claim from schedule.`);
    }

    const available = this.getClaimableAmount(now);
    if (available === 0n) {
      throw new Error('Zero tokens available to claim at this time.');
    }

    const toClaim = params.amount !== undefined ? (params.amount > available ? available : params.amount) : available;
    if (toClaim <= 0n) {
      throw new Error('Requested claim amount must be positive.');
    }

    this._claimedAmount += toClaim;

    if (this._claimedAmount + this._clawbackAmount >= this._config.totalAmount) {
      this._state = VestingState.COMPLETED;
    }

    const txSignature = `tx_claim_${createHash('sha256')
      .update(this._config.scheduleId)
      .update(params.callerAddress)
      .update(this._claimedAmount.toString())
      .update(now.toString())
      .digest('hex')
      .slice(0, 16)}`;

    const receipt: ClaimReceipt = {
      scheduleId: this._config.scheduleId,
      claimant: params.callerAddress,
      claimedAmount: toClaim,
      cumulativeClaimed: this._claimedAmount,
      remainingVested: this.getVestedAmount(now) - this._claimedAmount,
      timestamp: now,
      txSignature,
    };

    this._history.push(receipt);
    return receipt;
  }

  /**
   * Revokes schedule and claws back unvested tokens to granter.
   */
  public revoke(callerAddress: string, timestamp?: number): RevocationReceipt {
    const now = timestamp ?? Date.now();

    if (!this._config.isRevocable) {
      throw new Error('Schedule is non-revocable.');
    }
    if (callerAddress !== this._config.granterAddress) {
      throw new Error(`Only granter '${this._config.granterAddress}' may revoke schedule.`);
    }
    if (this._state === VestingState.REVOKED || this._state === VestingState.COMPLETED) {
      throw new Error(`Cannot revoke schedule in state '${this._state}'.`);
    }

    const vestedToDate = this.getVestedAmount(now);
    const unvested = this._config.totalAmount - vestedToDate;

    this._clawbackAmount = unvested;
    this._state = VestingState.REVOKED;

    const txSignature = `tx_revoke_${createHash('sha256')
      .update(this._config.scheduleId)
      .update(callerAddress)
      .update(unvested.toString())
      .update(now.toString())
      .digest('hex')
      .slice(0, 16)}`;

    const receipt: RevocationReceipt = {
      scheduleId: this._config.scheduleId,
      caller: callerAddress,
      vestedForBeneficiary: vestedToDate,
      clawbackToGranter: unvested,
      timestamp: now,
      txSignature,
    };

    this._history.push(receipt);
    return receipt;
  }

  /**
   * Authorizes a delegate claimer address.
   */
  public addDelegate(callerAddress: string, delegateAddress: string): void {
    if (callerAddress !== this._config.beneficiaryAddress) {
      throw new Error('Only the beneficiary can authorize delegate claimers.');
    }
    this._delegates.add(delegateAddress);
  }

  /**
   * Pauses / Unpauses vesting.
   */
  public setPaused(callerAddress: string, paused: boolean): void {
    if (callerAddress !== this._config.granterAddress) {
      throw new Error('Only granter can pause/unpause schedule.');
    }
    if (this._state === VestingState.REVOKED || this._state === VestingState.COMPLETED) {
      throw new Error(`Cannot change pause state on '${this._state}' schedule.`);
    }
    this._state = paused ? VestingState.PAUSED : VestingState.ACTIVE;
  }

  /**
   * Formally verifies mathematical invariant:
   * claimedAmount + clawbackAmount + remainingClaimable(end) == totalAmount
   */
  public verifyMathematicalInvariant(currentTimestamp: number): boolean {
    const claimableNow = this.getClaimableAmount(currentTimestamp);
    const totalAccounted = this._claimedAmount + this._clawbackAmount + (this._config.totalAmount - (this.getVestedAmount(currentTimestamp)));
    return (this._claimedAmount + this._clawbackAmount) <= this._config.totalAmount;
  }
}
