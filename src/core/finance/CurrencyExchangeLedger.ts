/**
 * Multi-Currency Exchange Ledger
 * Implements deterministic 8-decimal fixed-point math, double-entry bookkeeping,
 * atomic multi-currency FX swaps, slippage protection, and programmable escrow vaults.
 */

export const SCALE = 100_000_000n; // 10^8 fixed-point scaling factor

export const AccountType = {
  USER: 'USER',
  LIQUIDITY_POOL: 'LIQUIDITY_POOL',
  FEE_TREASURY: 'FEE_TREASURY',
  ESCROW_VAULT: 'ESCROW_VAULT',
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const EntryType = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  FX_SWAP: 'FX_SWAP',
  ESCROW_LOCK: 'ESCROW_LOCK',
  ESCROW_RELEASE: 'ESCROW_RELEASE',
  ESCROW_REFUND: 'ESCROW_REFUND',
} as const;

export type EntryType = (typeof EntryType)[keyof typeof EntryType];

export const EscrowStatus = {
  ACTIVE: 'ACTIVE',
  RELEASED: 'RELEASED',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED',
} as const;

export type EscrowStatus = (typeof EscrowStatus)[keyof typeof EscrowStatus];

export interface LedgerPosting {
  accountId: string;
  currency: string;
  amount: bigint; // positive = credit (increase), negative = debit (decrease)
}

export interface JournalEntry {
  entryId: string;
  entryType: EntryType;
  timestamp: number;
  postings: LedgerPosting[];
  memo?: string;
  previousHash: string;
  entryHash: string;
}

export interface EscrowAgreement {
  escrowId: string;
  creatorId: string;
  beneficiaryId: string;
  currency: string;
  amount: bigint;
  status: EscrowStatus;
  timelockExpiryMs: number;
  conditionsMet: boolean;
  createdAt: number;
}

export interface FXSwapRequest {
  accountId: string;
  fromCurrency: string;
  toCurrency: string;
  amountIn: bigint;
  minAmountOut: bigint; // Slippage protection
  feeBps?: number; // Basis points (e.g. 25 = 0.25%)
}

export interface FXSwapResult {
  swapId: string;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  effectiveRate: bigint;
  timestamp: number;
}

export class CurrencyExchangeLedger {
  // accountId -> currency -> balance
  private accounts: Map<string, Map<string, bigint>> = new Map();
  private accountTypes: Map<string, AccountType> = new Map();
  // key: "CUR1/CUR2" -> rate scaled by SCALE
  private rates: Map<string, bigint> = new Map();
  private journal: JournalEntry[] = [];
  private escrows: Map<string, EscrowAgreement> = new Map();
  private lastHash = '0000000000000000000000000000000000000000000000000000000000000000';

  public readonly treasuryAccountId: string;

  constructor(treasuryAccountId: string = 'treasury-system') {
    this.treasuryAccountId = treasuryAccountId;
    this.createAccount(treasuryAccountId, AccountType.FEE_TREASURY);
    this.createAccount('pool-fx-liquidity', AccountType.LIQUIDITY_POOL);
    this.createAccount('vault-escrow-reserve', AccountType.ESCROW_VAULT);
  }

  public createAccount(accountId: string, type: AccountType): void {
    if (!this.accounts.has(accountId)) {
      this.accounts.set(accountId, new Map());
      this.accountTypes.set(accountId, type);
    }
  }

  public getBalance(accountId: string, currency: string): bigint {
    return this.accounts.get(accountId)?.get(currency) ?? 0n;
  }

  /**
   * Sets the exchange rate for a currency pair.
   * e.g. setRate('SOL', 'USD', 180.5)
   */
  public setRate(fromCurrency: string, toCurrency: string, rate: number | bigint): void {
    const rateBig = typeof rate === 'bigint' ? rate : BigInt(Math.round(rate * 1e8));
    this.rates.set(`${fromCurrency}/${toCurrency}`, rateBig);
    // Automatically derive reverse rate if not explicitly zero
    if (rateBig > 0n) {
      const inverseRate = (SCALE * SCALE) / rateBig;
      this.rates.set(`${toCurrency}/${fromCurrency}`, inverseRate);
    }
  }

  public getRate(fromCurrency: string, toCurrency: string): bigint | undefined {
    if (fromCurrency === toCurrency) return SCALE;
    return this.rates.get(`${fromCurrency}/${toCurrency}`);
  }

  /**
   * Deposits funds into an account (offsetting the system/external pool).
   */
  public deposit(accountId: string, currency: string, amount: bigint, memo: string = 'Deposit'): JournalEntry {
    if (amount <= 0n) throw new Error('Deposit amount must be positive');
    this.createAccount(accountId, AccountType.USER);

    const postings: LedgerPosting[] = [
      { accountId, currency, amount },
      { accountId: 'pool-fx-liquidity', currency, amount: -amount },
    ];

    return this.commitJournalEntry(EntryType.DEPOSIT, postings, memo);
  }

  /**
   * Withdraws funds from an account.
   */
  public withdraw(accountId: string, currency: string, amount: bigint, memo: string = 'Withdrawal'): JournalEntry {
    if (amount <= 0n) throw new Error('Withdrawal amount must be positive');
    const balance = this.getBalance(accountId, currency);
    if (balance < amount) {
      throw new Error(`Insufficient funds: account has ${balance}, requested ${amount}`);
    }

    const postings: LedgerPosting[] = [
      { accountId, currency, amount: -amount },
      { accountId: 'pool-fx-liquidity', currency, amount },
    ];

    return this.commitJournalEntry(EntryType.WITHDRAWAL, postings, memo);
  }

  /**
   * Performs an atomic multi-currency FX swap between an account and liquidity pool.
   */
  public executeSwap(req: FXSwapRequest): FXSwapResult {
    const { accountId, fromCurrency, toCurrency, amountIn, minAmountOut } = req;
    const feeBps = req.feeBps ?? 30; // 0.30% fee

    if (amountIn <= 0n) throw new Error('Swap amountIn must be positive');
    const rate = this.getRate(fromCurrency, toCurrency);
    if (!rate) {
      throw new Error(`Exchange rate not found for ${fromCurrency}/${toCurrency}`);
    }

    const balance = this.getBalance(accountId, fromCurrency);
    if (balance < amountIn) {
      throw new Error(`Insufficient balance in ${fromCurrency}: available ${balance}, needed ${amountIn}`);
    }

    // Calculate gross output before fee
    const grossAmountOut = (amountIn * rate) / SCALE;

    // Deduct fee in output currency
    const feeAmount = (grossAmountOut * BigInt(feeBps)) / 10000n;
    const netAmountOut = grossAmountOut - feeAmount;

    // Verify slippage constraint
    if (netAmountOut < minAmountOut) {
      throw new Error(
        `Slippage exceeded: expected at least ${minAmountOut} ${toCurrency}, got ${netAmountOut}`
      );
    }

    // Atomic double-entry postings:
    // 1. User pays fromCurrency, pool receives fromCurrency
    // 2. Pool pays gross toCurrency, user receives net toCurrency, treasury receives fee
    const postings: LedgerPosting[] = [
      { accountId, currency: fromCurrency, amount: -amountIn },
      { accountId: 'pool-fx-liquidity', currency: fromCurrency, amount: amountIn },
      { accountId: 'pool-fx-liquidity', currency: toCurrency, amount: -grossAmountOut },
      { accountId, currency: toCurrency, amount: netAmountOut },
      { accountId: this.treasuryAccountId, currency: toCurrency, amount: feeAmount },
    ];

    const entry = this.commitJournalEntry(EntryType.FX_SWAP, postings, `FX Swap ${fromCurrency} -> ${toCurrency}`);

    return {
      swapId: entry.entryId,
      amountIn,
      amountOut: netAmountOut,
      feeAmount,
      effectiveRate: (netAmountOut * SCALE) / amountIn,
      timestamp: entry.timestamp,
    };
  }

  /**
   * Locks funds into a conditional multi-party escrow agreement.
   */
  public createEscrow(params: {
    escrowId: string;
    creatorId: string;
    beneficiaryId: string;
    currency: string;
    amount: bigint;
    timelockDurationMs: number;
  }): EscrowAgreement {
    const { escrowId, creatorId, beneficiaryId, currency, amount, timelockDurationMs } = params;
    if (this.escrows.has(escrowId)) {
      throw new Error(`Escrow agreement ${escrowId} already exists`);
    }

    const creatorBal = this.getBalance(creatorId, currency);
    if (creatorBal < amount) {
      throw new Error(`Insufficient funds for escrow: has ${creatorBal}, needed ${amount}`);
    }

    this.createAccount(creatorId, AccountType.USER);
    this.createAccount(beneficiaryId, AccountType.USER);

    // Transfer from creator to escrow vault
    const postings: LedgerPosting[] = [
      { accountId: creatorId, currency, amount: -amount },
      { accountId: 'vault-escrow-reserve', currency, amount },
    ];

    this.commitJournalEntry(EntryType.ESCROW_LOCK, postings, `Escrow lock ${escrowId}`);

    const now = Date.now();
    const agreement: EscrowAgreement = {
      escrowId,
      creatorId,
      beneficiaryId,
      currency,
      amount,
      status: EscrowStatus.ACTIVE,
      timelockExpiryMs: now + timelockDurationMs,
      conditionsMet: false,
      createdAt: now,
    };

    this.escrows.set(escrowId, agreement);
    return agreement;
  }

  /**
   * Releases escrow funds to the beneficiary when conditions are satisfied.
   */
  public releaseEscrow(escrowId: string): JournalEntry {
    const agreement = this.escrows.get(escrowId);
    if (!agreement) throw new Error(`Escrow agreement ${escrowId} not found`);
    if (agreement.status !== EscrowStatus.ACTIVE) {
      throw new Error(`Cannot release escrow with status ${agreement.status}`);
    }

    const postings: LedgerPosting[] = [
      { accountId: 'vault-escrow-reserve', currency: agreement.currency, amount: -agreement.amount },
      { accountId: agreement.beneficiaryId, currency: agreement.currency, amount: agreement.amount },
    ];

    const entry = this.commitJournalEntry(EntryType.ESCROW_RELEASE, postings, `Escrow release ${escrowId}`);
    agreement.status = EscrowStatus.RELEASED;
    agreement.conditionsMet = true;

    return entry;
  }

  /**
   * Refunds escrow funds back to the creator upon expiry or cancellation.
   */
  public refundEscrow(escrowId: string, currentTimeMs: number = Date.now()): JournalEntry {
    const agreement = this.escrows.get(escrowId);
    if (!agreement) throw new Error(`Escrow agreement ${escrowId} not found`);
    if (agreement.status !== EscrowStatus.ACTIVE) {
      throw new Error(`Cannot refund escrow with status ${agreement.status}`);
    }

    if (currentTimeMs < agreement.timelockExpiryMs) {
      throw new Error(`Timelock has not expired yet for escrow ${escrowId}`);
    }

    const postings: LedgerPosting[] = [
      { accountId: 'vault-escrow-reserve', currency: agreement.currency, amount: -agreement.amount },
      { accountId: agreement.creatorId, currency: agreement.currency, amount: agreement.amount },
    ];

    const entry = this.commitJournalEntry(EntryType.ESCROW_REFUND, postings, `Escrow refund ${escrowId}`);
    agreement.status = EscrowStatus.REFUNDED;

    return entry;
  }

  public getEscrow(escrowId: string): EscrowAgreement | undefined {
    return this.escrows.get(escrowId);
  }

  public getJournal(): JournalEntry[] {
    return [...this.journal];
  }

  public verifyLedgerIntegrity(): { isValid: boolean; verifiedEntries: number; error?: string } {
    let prev = '0000000000000000000000000000000000000000000000000000000000000000';
    for (let i = 0; i < this.journal.length; i++) {
      const entry = this.journal[i];
      if (entry.previousHash !== prev) {
        return { isValid: false, verifiedEntries: i, error: `Broken hash link at index ${i}` };
      }

      // Check double-entry balance: for each currency, sum(postings) must equal 0
      const currencySums = new Map<string, bigint>();
      for (const p of entry.postings) {
        const curSum = currencySums.get(p.currency) ?? 0n;
        currencySums.set(p.currency, curSum + p.amount);
      }

      for (const [currency, sum] of currencySums.entries()) {
        if (sum !== 0n) {
          return {
            isValid: false,
            verifiedEntries: i,
            error: `Double-entry imbalance in currency ${currency} at index ${i}: sum is ${sum}`,
          };
        }
      }

      const expectedHash = this.computeEntryHash(entry.previousHash, entry.postings, entry.timestamp);
      if (entry.entryHash !== expectedHash) {
        return { isValid: false, verifiedEntries: i, error: `Invalid entryHash at index ${i}` };
      }

      prev = entry.entryHash;
    }

    return { isValid: true, verifiedEntries: this.journal.length };
  }

  // --- Internal Commit & Hash ---

  private commitJournalEntry(
    entryType: EntryType,
    postings: LedgerPosting[],
    memo?: string
  ): JournalEntry {
    const timestamp = Date.now();
    const entryId = `entry-${timestamp}-${this.journal.length + 1}`;
    const entryHash = this.computeEntryHash(this.lastHash, postings, timestamp);

    // Apply balances
    for (const p of postings) {
      if (!this.accounts.has(p.accountId)) {
        this.accounts.set(p.accountId, new Map());
      }
      const accBalances = this.accounts.get(p.accountId)!;
      const current = accBalances.get(p.currency) ?? 0n;
      accBalances.set(p.currency, current + p.amount);
    }

    const entry: JournalEntry = {
      entryId,
      entryType,
      timestamp,
      postings,
      memo,
      previousHash: this.lastHash,
      entryHash,
    };

    this.journal.push(entry);
    this.lastHash = entryHash;

    return entry;
  }

  private computeEntryHash(prevHash: string, postings: LedgerPosting[], timestamp: number): string {
    const dataStr = `${prevHash}:${timestamp}:${postings.map((p) => `${p.accountId},${p.currency},${p.amount}`).join(';')}`;
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < dataStr.length; i++) {
      const ch = dataStr.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
  }
}
