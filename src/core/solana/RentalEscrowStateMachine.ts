/**
 * Solana Verifiable Rental Escrow State Machine
 * Implements binary Anchor account serialization, PDA seed derivation,
 * 2-of-3 multi-sig dispute resolution, and automated lamport fee routing.
 */

export const EscrowState = {
  UNINITIALIZED: 0,
  FUNDS_DEPOSITED: 1,
  ACTIVE_RENTAL: 2,
  DISPUTED: 3,
  SETTLED: 4,
  REFUNDED: 5,
  SLASHED: 6,
} as const;

export type EscrowState = (typeof EscrowState)[keyof typeof EscrowState];

export interface RentalEscrowAccount {
  renterPubkey: string; // 32-byte hex or base58 string
  venuePubkey: string;
  arbiterPubkey: string;
  rentalFeeLamports: bigint;
  securityDepositLamports: bigint;
  rentalStartTimestamp: bigint; // Unix timestamp seconds
  rentalDurationSeconds: bigint;
  state: EscrowState;
  bumpSeed: number;
}

export interface SettlementResult {
  account: RentalEscrowAccount;
  venuePayoutLamports: bigint;
  protocolFeeLamports: bigint;
  renterRefundLamports: bigint;
  settledAtTimestamp: number;
}

export const ESCROW_ACCOUNT_SIZE = 165;
export const ESCROW_DISCRIMINATOR = new Uint8Array([0x65, 0x73, 0x63, 0x72, 0x6f, 0x77, 0x5f, 0x31]); // 'escrow_1'

export class RentalEscrowStateMachine {
  private protocolFeeBps: number; // Platform fee in basis points (e.g. 150 = 1.5%)

  constructor(protocolFeeBps: number = 150) {
    this.protocolFeeBps = protocolFeeBps;
  }

  /**
   * Initializes a new escrow account with deposited rental and deposit lamports.
   */
  public initializeEscrow(params: {
    renterPubkey: string;
    venuePubkey: string;
    arbiterPubkey: string;
    rentalFeeLamports: bigint;
    securityDepositLamports: bigint;
    rentalDurationSeconds: bigint;
    bumpSeed?: number;
  }): RentalEscrowAccount {
    if (params.rentalFeeLamports <= 0n) {
      throw new Error('Rental fee must be greater than zero');
    }
    if (params.rentalDurationSeconds <= 0n) {
      throw new Error('Rental duration must be positive');
    }

    return {
      renterPubkey: params.renterPubkey,
      venuePubkey: params.venuePubkey,
      arbiterPubkey: params.arbiterPubkey,
      rentalFeeLamports: params.rentalFeeLamports,
      securityDepositLamports: params.securityDepositLamports,
      rentalStartTimestamp: 0n,
      rentalDurationSeconds: params.rentalDurationSeconds,
      state: EscrowState.FUNDS_DEPOSITED,
      bumpSeed: params.bumpSeed ?? 254,
    };
  }

  /**
   * Activates rental upon verified venue check-in.
   */
  public activateRental(
    account: RentalEscrowAccount,
    startTimestamp: number = Math.floor(Date.now() / 1000)
  ): RentalEscrowAccount {
    if (account.state !== EscrowState.FUNDS_DEPOSITED) {
      throw new Error(`Cannot activate rental in state ${account.state}`);
    }

    return {
      ...account,
      state: EscrowState.ACTIVE_RENTAL,
      rentalStartTimestamp: BigInt(startTimestamp),
    };
  }

  /**
   * Normal settlement at completion of the rental.
   * Transfers fee to venue (less protocol fee) and refunds deposit to renter.
   */
  public settleRental(
    account: RentalEscrowAccount,
    currentTimestamp: number = Math.floor(Date.now() / 1000)
  ): SettlementResult {
    if (account.state !== EscrowState.ACTIVE_RENTAL) {
      throw new Error(`Cannot settle rental from state ${account.state}`);
    }

    const protocolFee = (account.rentalFeeLamports * BigInt(this.protocolFeeBps)) / 10000n;
    const venuePayout = account.rentalFeeLamports - protocolFee;
    const renterRefund = account.securityDepositLamports;

    const settledAccount: RentalEscrowAccount = {
      ...account,
      state: EscrowState.SETTLED,
    };

    return {
      account: settledAccount,
      venuePayoutLamports: venuePayout,
      protocolFeeLamports: protocolFee,
      renterRefundLamports: renterRefund,
      settledAtTimestamp: currentTimestamp,
    };
  }

  /**
   * Raises a dispute, locking funds until resolved by multi-sig.
   */
  public disputeRental(account: RentalEscrowAccount, disputerPubkey: string): RentalEscrowAccount {
    if (account.state !== EscrowState.ACTIVE_RENTAL && account.state !== EscrowState.FUNDS_DEPOSITED) {
      throw new Error(`Cannot dispute rental in state ${account.state}`);
    }

    const isAuthorized =
      disputerPubkey === account.renterPubkey || disputerPubkey === account.venuePubkey;
    if (!isAuthorized) {
      throw new Error('Only renter or venue can initiate a dispute');
    }

    return {
      ...account,
      state: EscrowState.DISPUTED,
    };
  }

  /**
   * Resolves a dispute using 2-of-3 multi-sig approval between renter, venue, and arbiter.
   */
  public resolveDispute(
    account: RentalEscrowAccount,
    signatures: string[], // Pubkeys of signatories
    awardToVenueLamports: bigint,
    currentTimestamp: number = Math.floor(Date.now() / 1000)
  ): SettlementResult {
    if (account.state !== EscrowState.DISPUTED) {
      throw new Error(`Cannot resolve dispute for account in state ${account.state}`);
    }

    const totalVault = account.rentalFeeLamports + account.securityDepositLamports;
    if (awardToVenueLamports > totalVault) {
      throw new Error(`Award amount ${awardToVenueLamports} exceeds total escrow vault balance ${totalVault}`);
    }

    // Check 2-of-3 multi-sig quorum
    const validSigners = new Set([account.renterPubkey, account.venuePubkey, account.arbiterPubkey]);
    const distinctSigners = new Set(signatures.filter((s) => validSigners.has(s)));

    if (distinctSigners.size < 2) {
      throw new Error(`Insufficient multi-sig quorum: required 2 valid signatures, got ${distinctSigners.size}`);
    }

    const protocolFee = (awardToVenueLamports * BigInt(this.protocolFeeBps)) / 10000n;
    const venuePayout = awardToVenueLamports - protocolFee;
    const renterRefund = totalVault - awardToVenueLamports;

    const settledAccount: RentalEscrowAccount = {
      ...account,
      state: EscrowState.SETTLED,
    };

    return {
      account: settledAccount,
      venuePayoutLamports: venuePayout,
      protocolFeeLamports: protocolFee,
      renterRefundLamports: renterRefund,
      settledAtTimestamp: currentTimestamp,
    };
  }

  /**
   * Full cancellation or no-show refund to renter.
   */
  public refundRental(
    account: RentalEscrowAccount,
    currentTimestamp: number = Math.floor(Date.now() / 1000)
  ): SettlementResult {
    if (account.state !== EscrowState.FUNDS_DEPOSITED) {
      throw new Error(`Cannot refund rental in state ${account.state}`);
    }

    const totalRefund = account.rentalFeeLamports + account.securityDepositLamports;
    const refundedAccount: RentalEscrowAccount = {
      ...account,
      state: EscrowState.REFUNDED,
    };

    return {
      account: refundedAccount,
      venuePayoutLamports: 0n,
      protocolFeeLamports: 0n,
      renterRefundLamports: totalRefund,
      settledAtTimestamp: currentTimestamp,
    };
  }

  // --- Binary Serialization & Deserialization ---

  /**
   * Serializes a RentalEscrowAccount into a 165-byte Anchor/Solana binary buffer.
   */
  public serialize(account: RentalEscrowAccount): Uint8Array {
    const buffer = new Uint8Array(ESCROW_ACCOUNT_SIZE);
    const view = new DataView(buffer.buffer);

    // 1. Discriminator (8 bytes)
    buffer.set(ESCROW_DISCRIMINATOR, 0);

    // 2. Pubkeys (32 bytes each)
    buffer.set(this.pubkeyToBytes(account.renterPubkey), 8);
    buffer.set(this.pubkeyToBytes(account.venuePubkey), 40);
    buffer.set(this.pubkeyToBytes(account.arbiterPubkey), 72);

    // 3. Numeric Lamports (Little-Endian BigInt u64 / i64)
    view.setBigUint64(104, account.rentalFeeLamports, true);
    view.setBigUint64(112, account.securityDepositLamports, true);
    view.setBigInt64(120, account.rentalStartTimestamp, true);
    view.setBigInt64(128, account.rentalDurationSeconds, true);

    // 4. State & Bump Seed
    buffer[136] = account.state;
    buffer[137] = account.bumpSeed;

    return buffer;
  }

  /**
   * Deserializes a 165-byte binary buffer into a RentalEscrowAccount.
   */
  public deserialize(data: Uint8Array): RentalEscrowAccount {
    if (data.length < ESCROW_ACCOUNT_SIZE) {
      throw new Error(`Invalid buffer size: expected ${ESCROW_ACCOUNT_SIZE} bytes, got ${data.length}`);
    }

    // Verify Discriminator
    for (let i = 0; i < 8; i++) {
      if (data[i] !== ESCROW_DISCRIMINATOR[i]) {
        throw new Error('Invalid account discriminator');
      }
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const renterPubkey = this.bytesToPubkey(data.subarray(8, 40));
    const venuePubkey = this.bytesToPubkey(data.subarray(40, 72));
    const arbiterPubkey = this.bytesToPubkey(data.subarray(72, 104));

    const rentalFeeLamports = view.getBigUint64(104, true);
    const securityDepositLamports = view.getBigUint64(112, true);
    const rentalStartTimestamp = view.getBigInt64(120, true);
    const rentalDurationSeconds = view.getBigInt64(128, true);

    const state = data[136] as EscrowState;
    const bumpSeed = data[137];

    return {
      renterPubkey,
      venuePubkey,
      arbiterPubkey,
      rentalFeeLamports,
      securityDepositLamports,
      rentalStartTimestamp,
      rentalDurationSeconds,
      state,
      bumpSeed,
    };
  }

  /**
   * Derives a deterministic Program Derived Address (PDA) simulation.
   */
  public deriveEscrowPDA(
    programId: string,
    renter: string,
    venue: string,
    leaseId: string
  ): { pda: string; bump: number } {
    const raw = `pda:${programId}:${renter}:${venue}:${leaseId}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const hex = hash.toString(16).padStart(8, '0');
    return {
      pda: `escrow_${hex}`,
      bump: (hash & 0xff) || 254,
    };
  }

  // --- Byte Helpers ---

  private pubkeyToBytes(pubkey: string): Uint8Array {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < Math.min(pubkey.length, 32); i++) {
      bytes[i] = pubkey.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  private bytesToPubkey(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) break;
      str += String.fromCharCode(bytes[i]);
    }
    return str || '11111111111111111111111111111111';
  }
}
