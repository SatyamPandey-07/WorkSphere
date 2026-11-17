/**
 * @file CompressedDeskPassMinter.ts
 * @description Handles compressed desk pass minting on Solana with optimistic retry logic
 * for Concurrent Merkle Tree sequence number collisions.
 */

import {
  Connection,
  PublicKey,
  Signer,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

export interface MintPassOptions {
  treeAddress: PublicKey;
  recipient?: PublicKey;
  maxRetries?: number;
}

export class CompressedDeskPassMinter {
  /**
   * Mints a compressed desk pass with optimistic retry and exponential backoff
   * to handle sequence number mismatches on concurrent tree updates.
   */
  public static async mintCompressedPass(
    connection: Connection,
    payer: Signer,
    options: MintPassOptions,
  ): Promise<string> {
    const maxRetries = options.maxRetries ?? 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        attempt++;

        // 1. Fetch latest blockhash and update local tree state reference
        const latestBlockhash =
          await connection.getLatestBlockhash("confirmed");

        // 2. Build transaction instructions for compressed minting
        const instructions: TransactionInstruction[] = [];

        // Add your Bubblegum / compression program instruction building here
        // e.g., createMintToCollectionV1 or custom compressed pass instruction

        const messageV0 = new TransactionMessage({
          payerKey: payer.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([payer]);

        // 3. Send and confirm transaction with manual retry control
        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: false,
          maxRetries: 0,
        });

        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          "confirmed",
        );

        return signature;
      } catch (error: any) {
        const errorMessage = error?.message || "";
        const isSequenceError =
          errorMessage.includes("ConcurrentMerkleTreeError") ||
          errorMessage.includes("Sequence number mismatch") ||
          errorMessage.includes("Stale merkle tree");

        if (isSequenceError && attempt < maxRetries) {
          // Exponential backoff with randomized jitter to prevent thundering herd collisions
          const baseDelay = Math.min(1500, 150 * Math.pow(2, attempt));
          const jitter = Math.random() * 300;
          const delay = baseDelay + jitter;

          console.warn(
            `[CompressedDeskPassMinter] Sequence collision detected on attempt ${attempt}. Retrying in ${Math.round(delay)}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      "Failed to mint compressed desk pass after maximum retry attempts due to persistent sequence collisions.",
    );
  }
}
