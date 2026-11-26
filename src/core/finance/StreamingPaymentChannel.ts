/**
 * StreamingPaymentChannel.ts
 * Multi-currency off-chain streaming micro-payment channel coordinator.
 * Implements continuous per-second micro-billing, HMAC state ticket signing,
 * monotonic nonce validation, cooperative close, and unilateral dispute resolution.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export type ChannelStatus = 'OPEN' | 'STREAMING' | 'CHALLENGING' | 'SETTLED' | 'CLOSED';

export interface ChannelConfig {
  channelId: string;
  payerId: string;
  payeeId: string;
  tokenSymbol: string; // e.g., 'USD', 'USDC', 'CREDITS'
  initialCapacity: number;
  flowRatePerSec?: number; // micro-payments per second
  challengePeriodSec?: number; // Dispute duration (default 300s)
  expirationTimestamp: number;
}

export interface StateTicket {
  channelId: string;
  nonce: number;
  cumulativeAmountPaid: number;
  timestamp: number;
  signature: string;
}

export interface SettlementDistribution {
  channelId: string;
  tokenSymbol: string;
  payerPayout: number;
  payeePayout: number;
  finalNonce: number;
  status: ChannelStatus;
  settledAt: number;
}

export interface DisputeState {
  disputeTicket: StateTicket;
  initiatorId: string;
  challengeExpiresAt: number;
}

export class StreamingPaymentChannel {
  private readonly config: Required<ChannelConfig>;
  private readonly payerSecret: string;
  private readonly payeeSecret: string;

  private status: ChannelStatus = 'OPEN';
  private totalEscrow: number;
  private latestValidTicket: StateTicket | null = null;
  private disputeState: DisputeState | null = null;
  private settlement: SettlementDistribution | null = null;

  constructor(
    config: ChannelConfig,
    payerSecret: string = 'payer-secret-key-default',
    payeeSecret: string = 'payee-secret-key-default'
  ) {
    if (config.initialCapacity <= 0) {
      throw new Error('Initial channel capacity must be positive');
    }
    if (config.expirationTimestamp <= Date.now()) {
      throw new Error('Channel expiration must be in the future');
    }

    this.config = {
      channelId: config.channelId,
      payerId: config.payerId,
      payeeId: config.payeeId,
      tokenSymbol: config.tokenSymbol,
      initialCapacity: config.initialCapacity,
      flowRatePerSec: config.flowRatePerSec ?? 0.01,
      challengePeriodSec: config.challengePeriodSec ?? 300,
      expirationTimestamp: config.expirationTimestamp,
    };

    this.payerSecret = payerSecret;
    this.payeeSecret = payeeSecret;
    this.totalEscrow = config.initialCapacity;
  }

  // --- Channel State Inspection ---

  public getChannelId(): string {
    return this.config.channelId;
  }

  public getStatus(): ChannelStatus {
    return this.status;
  }

  public getTotalEscrow(): number {
    return this.totalEscrow;
  }

  public getRemainingCapacity(): number {
    const paid = this.latestValidTicket ? this.latestValidTicket.cumulativeAmountPaid : 0;
    return Math.max(0, this.totalEscrow - paid);
  }

  public getLatestTicket(): StateTicket | null {
    return this.latestValidTicket ? { ...this.latestValidTicket } : null;
  }

  // --- Off-Chain State Ticket Generation & Verification ---

  /**
   * Payer signs a new off-chain state ticket committing to a cumulative amount paid.
   */
  public generateStateTicket(cumulativeAmount: number, nonce?: number): StateTicket {
    if (this.status !== 'OPEN' && this.status !== 'STREAMING') {
      throw new Error(`Cannot generate ticket in status '${this.status}'`);
    }

    if (cumulativeAmount > this.totalEscrow) {
      throw new Error(
        `Cumulative amount ${cumulativeAmount} exceeds channel capacity ${this.totalEscrow}`
      );
    }

    const nextNonce = nonce ?? (this.latestValidTicket ? this.latestValidTicket.nonce + 1 : 1);
    const now = Date.now();

    const signature = this.computeTicketSignature(
      this.config.channelId,
      nextNonce,
      cumulativeAmount,
      now,
      this.payerSecret
    );

    const ticket: StateTicket = {
      channelId: this.config.channelId,
      nonce: nextNonce,
      cumulativeAmountPaid: cumulativeAmount,
      timestamp: now,
      signature,
    };

    return ticket;
  }

  /**
   * Payee verifies and accepts a new state ticket.
   */
  public acceptTicket(ticket: StateTicket): boolean {
    if (this.status !== 'OPEN' && this.status !== 'STREAMING') {
      return false;
    }

    if (!this.verifyTicketSignature(ticket, this.payerSecret)) {
      return false;
    }

    if (ticket.channelId !== this.config.channelId) {
      return false;
    }

    if (ticket.cumulativeAmountPaid > this.totalEscrow) {
      return false;
    }

    // Monotonic nonce and monotonic cumulative amount checks
    if (this.latestValidTicket) {
      if (ticket.nonce <= this.latestValidTicket.nonce) {
        return false;
      }
      if (ticket.cumulativeAmountPaid < this.latestValidTicket.cumulativeAmountPaid) {
        return false;
      }
    }

    this.latestValidTicket = ticket;
    this.status = 'STREAMING';
    return true;
  }

  // --- Continuous Streaming Automation ---

  /**
   * Simulates continuous per-second micro-payment stream progress.
   */
  public streamTicks(elapsedSeconds: number): StateTicket {
    const previousPaid = this.latestValidTicket ? this.latestValidTicket.cumulativeAmountPaid : 0;
    const addedAmount = elapsedSeconds * this.config.flowRatePerSec;
    const newCumulative = Math.min(this.totalEscrow, previousPaid + addedAmount);

    const ticket = this.generateStateTicket(newCumulative);
    this.acceptTicket(ticket);
    return ticket;
  }

  /**
   * Payer deposits additional funds to increase channel capacity without restarting the stream.
   */
  public topUp(amount: number): number {
    if (this.status === 'SETTLED' || this.status === 'CLOSED') {
      throw new Error('Cannot top up a closed or settled channel');
    }
    if (amount <= 0) {
      throw new Error('Top-up amount must be positive');
    }

    this.totalEscrow += amount;
    return this.totalEscrow;
  }

  // --- Settlement & Dispute Window ---

  /**
   * Cooperative mutual close: Both parties sign the final state ticket,
   * executing immediate zero-delay payout.
   */
  public cooperativeClose(
    finalTicket: StateTicket,
    payeeMutualSig: string
  ): SettlementDistribution {
    if (this.status === 'SETTLED' || this.status === 'CLOSED') {
      throw new Error('Channel already closed');
    }

    // Verify payer signature on ticket
    if (!this.verifyTicketSignature(finalTicket, this.payerSecret)) {
      throw new Error('Invalid payer ticket signature');
    }

    // Verify payee mutual co-signature
    const expectedPayeeSig = this.computeTicketSignature(
      finalTicket.channelId,
      finalTicket.nonce,
      finalTicket.cumulativeAmountPaid,
      finalTicket.timestamp,
      this.payeeSecret
    );

    if (expectedPayeeSig !== payeeMutualSig) {
      throw new Error('Invalid payee mutual co-signature');
    }

    const payeePayout = finalTicket.cumulativeAmountPaid;
    const payerPayout = Math.max(0, this.totalEscrow - payeePayout);

    this.status = 'SETTLED';
    this.settlement = {
      channelId: this.config.channelId,
      tokenSymbol: this.config.tokenSymbol,
      payerPayout,
      payeePayout,
      finalNonce: finalTicket.nonce,
      status: 'SETTLED',
      settledAt: Date.now(),
    };

    return { ...this.settlement };
  }

  /**
   * Unilateral close: Initiates a challenge period with the claimant's latest state ticket.
   */
  public initiateUnilateralClose(
    disputeTicket: StateTicket,
    initiatorId: string
  ): DisputeState {
    if (this.status === 'SETTLED' || this.status === 'CLOSED') {
      throw new Error('Channel already closed');
    }

    if (!this.verifyTicketSignature(disputeTicket, this.payerSecret)) {
      throw new Error('Invalid ticket signature in dispute claim');
    }

    const now = Date.now();
    const challengeExpiresAt = now + this.config.challengePeriodSec * 1000;

    this.status = 'CHALLENGING';
    this.disputeState = {
      disputeTicket,
      initiatorId,
      challengeExpiresAt,
    };

    return { ...this.disputeState };
  }

  /**
   * Submits a higher valid nonce ticket to counter an outdated unilateral claim during challenge window.
   */
  public submitCounterTicket(counterTicket: StateTicket): boolean {
    if (this.status !== 'CHALLENGING' || !this.disputeState) {
      throw new Error('Channel is not in active dispute challenge');
    }

    if (Date.now() > this.disputeState.challengeExpiresAt) {
      throw new Error('Dispute challenge window has already expired');
    }

    if (!this.verifyTicketSignature(counterTicket, this.payerSecret)) {
      return false;
    }

    // Counter ticket must have strictly higher nonce
    if (counterTicket.nonce <= this.disputeState.disputeTicket.nonce) {
      return false;
    }

    this.disputeState.disputeTicket = counterTicket;
    return true;
  }

  /**
   * Finalizes the dispute after challenge period expiration, releasing funds.
   */
  public finalizeDispute(): SettlementDistribution {
    if (this.status !== 'CHALLENGING' || !this.disputeState) {
      throw new Error('No active dispute to finalize');
    }

    if (Date.now() < this.disputeState.challengeExpiresAt) {
      throw new Error('Challenge period has not yet elapsed');
    }

    const finalTicket = this.disputeState.disputeTicket;
    const payeePayout = finalTicket.cumulativeAmountPaid;
    const payerPayout = Math.max(0, this.totalEscrow - payeePayout);

    this.status = 'SETTLED';
    this.settlement = {
      channelId: this.config.channelId,
      tokenSymbol: this.config.tokenSymbol,
      payerPayout,
      payeePayout,
      finalNonce: finalTicket.nonce,
      status: 'SETTLED',
      settledAt: Date.now(),
    };

    return { ...this.settlement };
  }

  // --- Cryptographic Helpers ---

  public computeTicketSignature(
    channelId: string,
    nonce: number,
    amount: number,
    timestamp: number,
    secret: string
  ): string {
    const payload = `${channelId}:${nonce}:${amount.toFixed(6)}:${timestamp}`;
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  public verifyTicketSignature(ticket: StateTicket, secret: string): boolean {
    const expected = this.computeTicketSignature(
      ticket.channelId,
      ticket.nonce,
      ticket.cumulativeAmountPaid,
      ticket.timestamp,
      secret
    );
    if (expected.length !== ticket.signature.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(ticket.signature));
  }
}
