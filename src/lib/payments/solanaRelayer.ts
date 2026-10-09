import {
  Connection,
  Keypair,
  Transaction,
} from "@solana/web3.js";
import {
  DEFAULT_MAX_RELAY_FEE_LAMPORTS,
  validateRelayFeeLamports,
} from "@/lib/payments/solanaPay";

const MAX_SERIALIZED_TRANSACTION_BYTES = 1_232;

export interface RelayedSolanaTransaction {
  signature: string;
  feeLamports: number;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function getRelayerKeypair(): Keypair {
  let secretKey: unknown;
  try {
    secretKey = JSON.parse(getRequiredEnv("SOLANA_RELAYER_PRIVATE_KEY"));
  } catch {
    throw new Error("SOLANA_RELAYER_PRIVATE_KEY must be a JSON array");
  }

  if (
    !Array.isArray(secretKey) ||
    secretKey.length !== 64 ||
    secretKey.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 255,
    )
  ) {
    throw new Error("SOLANA_RELAYER_PRIVATE_KEY must contain 64 bytes");
  }

  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function decodeTransaction(serializedTransaction: string): Transaction {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(serializedTransaction)) {
    throw new Error("Transaction must be base64 encoded");
  }

  const bytes = Buffer.from(serializedTransaction, "base64");
  if (bytes.length === 0 || bytes.length > MAX_SERIALIZED_TRANSACTION_BYTES) {
    throw new Error("Transaction has an invalid size");
  }

  return Transaction.from(bytes);
}

export async function relayGaslessUsdcTransaction(
  serializedTransaction: string,
): Promise<RelayedSolanaTransaction> {
  const relayer = getRelayerKeypair();
  const transaction = decodeTransaction(serializedTransaction);

  if (
    !transaction.feePayer ||
    !transaction.feePayer.equals(relayer.publicKey)
  ) {
    throw new Error("Transaction fee payer must be the configured relayer");
  }

  const hasUserSignature = transaction.signatures.some(
    ({ publicKey, signature }) =>
      !publicKey.equals(relayer.publicKey) && signature !== null,
  );
  if (!hasUserSignature) {
    throw new Error("Transaction must include a user signature");
  }

  const connection = new Connection(
    getRequiredEnv("SOLANA_RPC_URL"),
    "confirmed",
  );
  const feeResponse = await connection.getFeeForMessage(
    transaction.compileMessage(),
    "confirmed",
  );
  if (feeResponse.value === null) {
    throw new Error("Unable to estimate transaction fee");
  }

  const maxFeeLamports = Number(
    process.env.SOLANA_MAX_RELAY_FEE_LAMPORTS ??
      DEFAULT_MAX_RELAY_FEE_LAMPORTS,
  );
  const feeLamports = validateRelayFeeLamports(
    feeResponse.value,
    maxFeeLamports,
  );

  transaction.partialSign(relayer);
  const serialized = transaction.serialize({
    requireAllSignatures: true,
    verifySignatures: true,
  });
  const signature = await connection.sendRawTransaction(serialized, {
    skipPreflight: false,
    maxRetries: 3,
  });

  return { signature, feeLamports };
}
