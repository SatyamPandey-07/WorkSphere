import {
  EscrowTransitionError,
  isAutoRefundEligible,
  transitionEscrowRecord,
  type EscrowLifecycleState,
  type EscrowRecord,
} from '@/lib/solana/escrowStateMachine';

export interface SettlementRequest {
  escrowId: string;
  targetState: Extract<
    EscrowLifecycleState,
    'released' | 'refunded' | 'partially_refunded'
  >;
  idempotencyKey: string;
  refundBasisPoints?: number;
  nowUnixSeconds?: number;
}

export interface SettlementReceipt {
  idempotencyKey: string;
  txSignature: string;
  escrow: EscrowRecord;
  deduplicated: boolean;
}

export interface SolanaEscrowRpcLike {
  submitSettlement?: (
    record: EscrowRecord,
    idempotencyKey: string
  ) => Promise<{ txSignature: string }>;
}

export class SolanaEscrowClient {
  private readonly rpc: SolanaEscrowRpcLike;
  private readonly escrows = new Map<string, EscrowRecord>();
  private readonly settlementReceipts = new Map<string, SettlementReceipt>();
  private readonly inFlightSettlements = new Map<
    string,
    Promise<SettlementReceipt>
  >();

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  _allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId,
  );
  return address;
}

export function createTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: number | bigint,
  multiSigners: (PublicKey | any)[] = [],
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0); // Instruction 3: Transfer
  data.writeBigUInt64LE(BigInt(amount), 1);

  const keys = [
    { pubkey: source, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
    ...multiSigners.map((signer) => ({
      pubkey: signer.publicKey || signer,
      isSigner: true,
      isWritable: false,
    })),
  ];

  return new TransactionInstruction({ keys, programId, data });
}

export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ??
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
export const USDC_DECIMALS = 6;
export const SOLANA_DEPOSIT_FEE_RESERVE_LAMPORTS = 5_000_000n;

export type EscrowCurrency = "SOL" | "USDC";

export interface EscrowDepositParams {
  payerWallet: string;
  bookingId: string;
  amount: number;
  currency: EscrowCurrency;
  rpcUrl: string;
}

export interface EscrowDepositResult {
  serializedTransaction: string;
  escrowVault: string;
  escrowBump: number;
  amountBaseUnits: bigint;
  recentBlockhash: string;
}

export type EscrowDepositPreflightErrorCode =
  | "INSUFFICIENT_BALANCE"
  | "BALANCE_CHECK_FAILED"
  | "INVALID_TOKEN_ACCOUNT"
  | "RPC_REQUEST_FAILED";

export class EscrowDepositPreflightError extends Error {
  public readonly rpcError?: unknown;

  constructor(
    message: string,
    public readonly code: EscrowDepositPreflightErrorCode,
    cause?: unknown,
  ) {
    super(message);
    this.name = "EscrowDepositPreflightError";
    this.rpcError = cause;
  }
}

export interface EscrowValidationResult {
  valid: boolean;
  error?: string;
}

export function toBaseUnits(amount: number, currency: EscrowCurrency): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `Invalid amount: must be a positive finite number, got ${amount}`,
    );
  }

  const multiplier =
    currency === "SOL" ? LAMPORTS_PER_SOL : 10 ** USDC_DECIMALS;
  const baseUnits = Math.round(amount * multiplier);

  if (!Number.isSafeInteger(baseUnits) || baseUnits <= 0) {
    throw new Error(
      `Amount ${amount} ${currency} converts to an unsafe integer (${baseUnits})`,
    );
  }

  return BigInt(baseUnits);
}

function formatBaseUnits(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function getTokenAccountErrorReason(
  error: unknown,
): "missing" | "uninitialized" | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/could not find account|account not found/i.test(message)) {
    return "missing";
  }
  if (/account not initialized/i.test(message)) return "uninitialized";
  return null;
}

async function withEscrowRpcTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationDescription: string,
  errorCode:
    "BALANCE_CHECK_FAILED" | "RPC_REQUEST_FAILED" = "BALANCE_CHECK_FAILED",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Solana RPC request timed out after ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } catch (error: unknown) {
    const timedOut =
      error instanceof Error && error.message.includes("timed out");
    throw new EscrowDepositPreflightError(
      timedOut
        ? `Could not ${operationDescription} because the Solana RPC request timed out. Please try again.`
        : `Could not ${operationDescription} because the Solana RPC request failed. Please try again.`,
      errorCode,
      error,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function getVerifiedLamportBalance(
  connection: Connection,
  payer: PublicKey,
  timeoutMs: number,
): Promise<bigint> {
  const balance = await withEscrowRpcTimeout(
    () => connection.getBalance(payer, "confirmed"),
    timeoutMs,
    "verify the wallet balance",
  );

  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new EscrowDepositPreflightError(
      "Could not verify wallet balance because Solana RPC returned invalid balance data. Please try again.",
      "BALANCE_CHECK_FAILED",
    );
  }

  return BigInt(balance);
}

export async function verifyEscrowDepositBalance(
  connection: Connection,
  params: Pick<EscrowDepositParams, "payerWallet" | "amount" | "currency">,
  timeoutMs: number = ESCROW_RPC_REQUEST_TIMEOUT_MS,
): Promise<void> {
  const payer = new PublicKey(params.payerWallet);
  const solBalance = await getVerifiedLamportBalance(
    connection,
    payer,
    timeoutMs,
  );

  if (params.currency === "SOL") {
    const requiredLamports =
      toBaseUnits(params.amount, "SOL") + SOLANA_DEPOSIT_FEE_RESERVE_LAMPORTS;

    if (solBalance < requiredLamports) {
      throw new EscrowDepositPreflightError(
        `Insufficient wallet balance (Required: ${formatBaseUnits(requiredLamports, 9)} SOL, Available: ${formatBaseUnits(solBalance, 9)} SOL)`,
        "INSUFFICIENT_BALANCE",
      );
    }

    return;
  }

  if (solBalance < SOLANA_DEPOSIT_FEE_RESERVE_LAMPORTS) {
    throw new EscrowDepositPreflightError(
      `Insufficient SOL balance for fees and rent (Required: 0.005 SOL, Available: ${formatBaseUnits(solBalance, 9)} SOL). The USDC deposit requires ${formatBaseUnits(toBaseUnits(params.amount, "USDC"), USDC_DECIMALS)} USDC.`,
      "INSUFFICIENT_BALANCE",
    );
  }

  const payerAta = getAssociatedTokenAddressSync(USDC_MINT, payer);
  const requiredUsdcBaseUnits = toBaseUnits(params.amount, "USDC");
  const tokenAccount = await withEscrowRpcTimeout(
    () => connection.getAccountInfo(payerAta, "confirmed"),
    timeoutMs,
    "verify the USDC token account",
  );

  if (!tokenAccount) {
    throw new EscrowDepositPreflightError(
      `Insufficient USDC balance (Required: ${formatBaseUnits(requiredUsdcBaseUnits, USDC_DECIMALS)} USDC, Available: 0 USDC). A separate 0.005 SOL reserve is required for fees and rent.`,
      "INSUFFICIENT_BALANCE",
    );
  }

  if (!tokenAccount.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new EscrowDepositPreflightError(
      "The USDC token account is invalid. Please verify the account and try again.",
      "INVALID_TOKEN_ACCOUNT",
    );
  }

  const tokenBalance = await withEscrowRpcTimeout(
    () => connection.getTokenAccountBalance(payerAta, "confirmed"),
    timeoutMs,
    "verify the USDC token balance",
  ).catch((error: unknown) => {
    const tokenAccountError =
      error instanceof EscrowDepositPreflightError
        ? getTokenAccountErrorReason(error.rpcError)
        : null;

    if (tokenAccountError === "missing") {
      throw new EscrowDepositPreflightError(
        `Insufficient USDC balance (Required: ${formatBaseUnits(requiredUsdcBaseUnits, USDC_DECIMALS)} USDC, Available: 0 USDC). A separate 0.005 SOL reserve is required for fees and rent.`,
        "INSUFFICIENT_BALANCE",
        error,
      );
    }

    if (tokenAccountError === "uninitialized") {
      throw new EscrowDepositPreflightError(
        "The USDC token account is not initialized. Initialize and fund it before retrying.",
        "INVALID_TOKEN_ACCOUNT",
        error,
      );
    }
    throw error;
  });

  const { amount, decimals } = tokenBalance.value;
  if (decimals !== USDC_DECIMALS || !/^\d+$/.test(amount)) {
    throw new EscrowDepositPreflightError(
      "Could not verify the USDC token balance because Solana RPC returned invalid token balance data. Please try again.",
      "BALANCE_CHECK_FAILED",
    );
  }

  const availableUsdcBaseUnits = BigInt(amount);
  if (availableUsdcBaseUnits < requiredUsdcBaseUnits) {
    throw new EscrowDepositPreflightError(
      `Insufficient USDC balance (Required: ${formatBaseUnits(requiredUsdcBaseUnits, USDC_DECIMALS)} USDC, Available: ${formatBaseUnits(availableUsdcBaseUnits, USDC_DECIMALS)} USDC). A separate 0.005 SOL reserve is required for fees and rent.`,
      "INSUFFICIENT_BALANCE",
    );
  }
}

export function validateDepositParams(
  params: EscrowDepositParams,
): EscrowValidationResult {
  try {
    if (!params.payerWallet || typeof params.payerWallet !== "string") {
      return { valid: false, error: "payerWallet is required" };
    }
    try {
      new PublicKey(params.payerWallet);
    } catch {
      return { valid: false, error: "Invalid payerWallet address" };
    }

    if (!params.bookingId || typeof params.bookingId !== "string") {
      return { valid: false, error: "bookingId is required" };
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return {
        valid: false,
        error: "amount must be a positive finite number",
      };
    }

    if (params.currency !== "SOL" && params.currency !== "USDC") {
      return { valid: false, error: "currency must be SOL or USDC" };
    }

    if (!params.rpcUrl || typeof params.rpcUrl !== "string") {
      return { valid: false, error: "rpcUrl is required" };
    }

    deriveEscrowPDA(params.bookingId);
    toBaseUnits(params.amount, params.currency);

    return { valid: true };
  } catch (e: unknown) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : "Unknown validation error",
    };
  }
}

export async function buildSolDepositTransaction(
  params: EscrowDepositParams,
): Promise<EscrowDepositResult> {
  const validation = validateDepositParams(params);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.error}`);
  }

  const payer = new PublicKey(params.payerWallet);
  const { address: escrowVault, bump } = deriveEscrowPDA(params.bookingId);
  const amountBaseUnits = toBaseUnits(params.amount, "SOL");

  const connection = new Connection(params.rpcUrl, "confirmed");
  await verifyEscrowDepositBalance(connection, params);
  const { blockhash } = await withEscrowRpcTimeout(
    () => connection.getLatestBlockhash("confirmed"),
    ESCROW_RPC_REQUEST_TIMEOUT_MS,
    "prepare the escrow transaction",
    "RPC_REQUEST_FAILED",
  );

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  });

  const memoData = Buffer.from(
    JSON.stringify({ bookingId: params.bookingId, type: "escrow_deposit" }),
  );

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: escrowVault,
      lamports: amountBaseUnits,
    }),
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: ESCROW_PROGRAM_ID,
      data: memoData,
    }),
  );

  const serialized = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  return {
    serializedTransaction: serialized,
    escrowVault: escrowVault.toBase58(),
    escrowBump: bump,
    amountBaseUnits,
    recentBlockhash: blockhash,
  };
}

export async function buildUsdcDepositTransaction(
  params: EscrowDepositParams,
): Promise<EscrowDepositResult> {
  const validation = validateDepositParams(params);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.error}`);
  }

  const payer = new PublicKey(params.payerWallet);
  const { address: escrowVault, bump } = deriveEscrowPDA(params.bookingId);
  const amountBaseUnits = toBaseUnits(params.amount, "USDC");

  const connection = new Connection(params.rpcUrl, "confirmed");
  await verifyEscrowDepositBalance(connection, params);
  const { blockhash } = await withEscrowRpcTimeout(
    () => connection.getLatestBlockhash("confirmed"),
    ESCROW_RPC_REQUEST_TIMEOUT_MS,
    "prepare the escrow transaction",
    "RPC_REQUEST_FAILED",
  );

  const payerAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    payer,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const vaultAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    escrowVault,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  });

  const memoData = Buffer.from(
    JSON.stringify({
      bookingId: params.bookingId,
      type: "escrow_deposit_usdc",
    }),
  );

  transaction.add(
    createTransferInstruction(
      payerAta,
      vaultAta,
      payer,
      amountBaseUnits,
      [],
      TOKEN_PROGRAM_ID,
    ),
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: ESCROW_PROGRAM_ID,
      data: memoData,
    }),
  );

  const serialized = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  return {
    serializedTransaction: serialized,
    escrowVault: escrowVault.toBase58(),
    escrowBump: bump,
    amountBaseUnits,
    recentBlockhash: blockhash,
  };
}

export async function buildDepositTransaction(
  params: EscrowDepositParams,
): Promise<EscrowDepositResult> {
  if (params.currency === "SOL") {
    return buildSolDepositTransaction(params);
  }

  public registerEscrow(record: EscrowRecord): void {
    this.escrows.set(record.escrowId, record);
  }

  public getEscrow(escrowId: string): EscrowRecord | undefined {
    return this.escrows.get(escrowId);
  }

  public openDispute(
    escrowId: string,
    disputeReason: string,
    nowUnixSeconds?: number
  ): EscrowRecord {
    const current = this.escrows.get(escrowId);
    if (!current) {
      throw new Error(`Escrow "${escrowId}" not found`);
    }
    const updated = transitionEscrowRecord(current, 'disputed', {
      disputeReason,
      nowUnixSeconds,
    });
    this.escrows.set(escrowId, updated);
    return updated;
  }

  public async settleEscrow(
    request: SettlementRequest
  ): Promise<SettlementReceipt> {
    const existingReceipt = this.settlementReceipts.get(request.idempotencyKey);
    if (existingReceipt) {
      return { ...existingReceipt, deduplicated: true };
    }

    const inFlight = this.inFlightSettlements.get(request.idempotencyKey);
    if (inFlight) {
      const receipt = await inFlight;
      return { ...receipt, deduplicated: true };
    }

    const execution = (async (): Promise<SettlementReceipt> => {
      const current = this.escrows.get(request.escrowId);
      if (!current) {
        throw new Error(`Escrow "${request.escrowId}" not found`);
      }

      const nextRecord = transitionEscrowRecord(current, request.targetState, {
        refundBasisPoints: request.refundBasisPoints,
        nowUnixSeconds: request.nowUnixSeconds,
      });

      const txResult =
        typeof this.rpc.submitSettlement === 'function'
          ? await this.rpc.submitSettlement(nextRecord, request.idempotencyKey)
          : {
              txSignature: `sig_${request.escrowId}_${request.idempotencyKey}`,
            };

      this.escrows.set(request.escrowId, nextRecord);

      const receipt: SettlementReceipt = {
        idempotencyKey: request.idempotencyKey,
        txSignature: txResult.txSignature,
        escrow: nextRecord,
        deduplicated: false,
      };
      this.settlementReceipts.set(request.idempotencyKey, receipt);
      return receipt;
    })();

    this.inFlightSettlements.set(request.idempotencyKey, execution);
    try {
      return await execution;
    } finally {
      this.inFlightSettlements.delete(request.idempotencyKey);
    }
  }

  public async triggerGracePeriodAutoRefund(
    escrowId: string,
    idempotencyKey: string,
    nowUnixSeconds?: number
  ): Promise<SettlementReceipt> {
    const current = this.escrows.get(escrowId);
    if (!current) {
      throw new Error(`Escrow "${escrowId}" not found`);
    }

    const eligible = isAutoRefundEligible({
      state: current.state,
      fundedAtUnixSeconds: current.fundedAtUnixSeconds,
      gracePeriodSeconds: current.gracePeriodSeconds,
      hostCheckedIn: current.hostCheckedIn,
      nowUnixSeconds,
    });

    if (!eligible) {
      throw new EscrowTransitionError(
        current.state,
        'refunded',
        'Escrow is not eligible for grace-period auto-refund'
      );
    }

    return this.settleEscrow({
      escrowId,
      targetState: 'refunded',
      idempotencyKey,
      nowUnixSeconds,
    });
  }
}
