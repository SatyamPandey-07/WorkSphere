/**
 * solanaPay.ts
 * Solana Pay protocol helper for generating SPL-Token (USDC) QR codes & payment links.
 */

export const SOLANA_USDC_MINT_MAINNET =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const DEFAULT_TREASURY_SOLANA_ADDRESS =
  "WorkSpHere5oLanaPayUSDC111111111111111111111";

export const DEFAULT_MAX_RELAY_FEE_LAMPORTS = 10_000;

export interface GaslessTransactionRequest {
  transaction: string;
}

/**
 * Rejects transaction fees that could unexpectedly drain the relayer wallet.
 */
export function validateRelayFeeLamports(
  feeLamports: number,
  maxFeeLamports = DEFAULT_MAX_RELAY_FEE_LAMPORTS,
): number {
  if (!Number.isInteger(feeLamports) || !Number.isSafeInteger(feeLamports) || feeLamports <= 0) {
    throw new RangeError("Relay fee must be a positive integer greater than zero");
  }
  if (!Number.isInteger(maxFeeLamports) || !Number.isSafeInteger(maxFeeLamports) || maxFeeLamports <= 0) {
    throw new RangeError("Maximum relay fee must be a positive integer greater than zero");
  }
  if (feeLamports > maxFeeLamports) {
    throw new RangeError("Transaction fee exceeds the relayer limit");
  }
  return feeLamports;
}

export interface SolanaPayParams {
  recipient: string;
  amount: number; // USDC amount
  splToken?: string; // Mint address (default USDC)
  reference?: string; // Base58 or unique reference public key / string
  label?: string;
  message?: string;
  memo?: string;
}

export const SOLANA_PAY_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes blockhash TTL

export interface SolanaPayStatusResponse {
  reference: string;
  status: "PENDING" | "PROCESSING" | "CONFIRMED" | "FAILED" | "EXPIRED";
  signature?: string;
  slot?: number;
  timestamp?: string;
  createdAt?: number;
  message?: string;
  error?: string;
}

/**
 * Builds a standardized Solana Pay protocol URI string.
 * Format: solana:<recipient>?amount=<amount>&spl-token=<usdc_mint>&reference=<ref>&label=<label>&message=<message>&memo=<memo>
 */
export function createSolanaPayUrl(params: SolanaPayParams): string {
  const recipient = params.recipient || DEFAULT_TREASURY_SOLANA_ADDRESS;
  const amountStr = params.amount.toFixed(2);
  const splToken = params.splToken || SOLANA_USDC_MINT_MAINNET;

  const searchParams = new URLSearchParams();
  searchParams.set("amount", amountStr);
  searchParams.set("spl-token", splToken);

  if (params.reference) {
    searchParams.set("reference", params.reference);
  }
  if (params.label) {
    searchParams.set("label", params.label);
  }
  if (params.message) {
    searchParams.set("message", params.message);
  }
  if (params.memo) {
    searchParams.set("memo", params.memo);
  }

  return `solana:${recipient}?${searchParams.toString()}`;
}

/**
 * Generates a unique transaction reference ID for payment tracking.
 */
export function generateSolanaPaymentReference(): string {
  return `tx_sol_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Builds a link to view a confirmed transaction on Solana Explorer.
 */
export function getSolanaExplorerUrl(signature: string, cluster?: string): string {
  const clusterParam = cluster ? `?cluster=${encodeURIComponent(cluster)}` : "";
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${clusterParam}`;
}

/**
 * Checks if a Solana Pay transaction reference has exceeded its timeout TTL.
 */
export function isSolanaPaymentExpired(
  createdAt: number,
  timeoutMs = SOLANA_PAY_DEFAULT_TIMEOUT_MS,
  now = Date.now()
): boolean {
  return now - createdAt >= timeoutMs;
}

/**
 * Polls payment status from the status API, cleanly returning an EXPIRED status
 * when the transaction timeout / blockhash TTL is exceeded or when simulation errors occur.
 */
export async function pollPaymentStatus(
  reference: string,
  options: {
    statusApiUrl?: string;
    timeoutMs?: number;
    startTime?: number;
  } = {}
): Promise<SolanaPayStatusResponse> {
  const startTime = options.startTime ?? Date.now();
  const timeoutMs = options.timeoutMs ?? SOLANA_PAY_DEFAULT_TIMEOUT_MS;
  const baseUrl = options.statusApiUrl ?? "/api/payments/solana/status";

  // Check client-side expiration upfront
  if (Date.now() - startTime >= timeoutMs) {
    return {
      reference,
      status: "EXPIRED",
      message: "Transaction expired. Please generate a new QR code.",
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const res = await fetch(`${baseUrl}?reference=${encodeURIComponent(reference)}`);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return {
        reference,
        status: "FAILED",
        error: errBody.error || `HTTP error ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    }
    const data: SolanaPayStatusResponse = await res.json();
    return data;
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    if (
      errorMessage.toLowerCase().includes("timeout") ||
      errorMessage.toLowerCase().includes("simulation failed") ||
      Date.now() - startTime >= timeoutMs
    ) {
      return {
        reference,
        status: "EXPIRED",
        message: "Transaction expired. Please generate a new QR code.",
        timestamp: new Date().toISOString(),
      };
    }
    return {
      reference,
      status: "FAILED",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    };
  }
}
