"use client";

/**
 * useNomadEscrow.ts
 *
 * Custom React hook for executing, simulating, and reconciling Solana escrow transactions
 * with optimistic UI updates and wallet-scoped balance caching (#10453).
 *
 * Wallet Balance Caching & Disconnect/Reconnect Invalidation (#10453):
 * - Balances are scoped strictly to the currently connected wallet's public key (base58).
 * - When a wallet disconnects, switches, or reconnects, cached balance and preflight state
 *   is invalidated immediately so balances from one wallet are never reused for another.
 * - Stale-request protection: uses an incrementing session/request generation ID and
 *   AbortController to cancel in-flight balance requests and ignore responses from previous
 *   wallet sessions or earlier balance queries.
 * - Preflight balance checks verify whether the current wallet has sufficient lamports
 *   before transaction submission, refreshing from RPC when stale or missing.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  simulateEscrowTransaction,
  reconcilePendingSignature,
} from "@/lib/solana/escrowClient";

export type EscrowStatus = "idle" | "simulating" | "confirmed_optimistic" | "finalized" | "error";

export interface WalletBalanceCacheEntry {
  publicKey: string;
  lamports: number;
  sol: number;
  fetchedAt: number;
}

export interface UseNomadEscrowOptions {
  rpcUrl?: string;
  walletPublicKey?: string | PublicKey | null;
  /** Balance cache TTL in milliseconds (default: 30 seconds) */
  cacheTtlMs?: number;
}

export interface PreflightCheckResult {
  allowed: boolean;
  balanceLamports: number;
  requiredLamports: number;
  error?: string;
}

export function useNomadEscrow(
  rpcUrlOrOptions: string | UseNomadEscrowOptions = "https://api.mainnet-beta.solana.com"
) {
  const options: UseNomadEscrowOptions =
    typeof rpcUrlOrOptions === "string"
      ? { rpcUrl: rpcUrlOrOptions }
      : rpcUrlOrOptions;

  const rpcUrl = options.rpcUrl || "https://api.mainnet-beta.solana.com";
  const rawWallet = options.walletPublicKey;
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;

  const currentWalletKey: string | null = rawWallet
    ? typeof rawWallet === "string"
      ? rawWallet.trim()
      : rawWallet.toBase58()
    : null;

  const [status, setStatus] = useState<EscrowStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);

  // Balance & Preflight state
  const [balance, setBalance] = useState<number | null>(null); // in SOL
  const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState<boolean>(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // Session-generation tracking & wallet-scoped cache refs to prevent stale responses
  const sessionGenRef = useRef<number>(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const cachedBalanceRef = useRef<WalletBalanceCacheEntry | null>(null);
  const activeWalletRef = useRef<string | null>(currentWalletKey);

  /**
   * Invalidates cached balance and aborts in-flight requests.
   */
  const invalidateBalanceCache = useCallback(() => {
    cachedBalanceRef.current = null;
    setBalance(null);
    setBalanceLamports(null);
    setBalanceError(null);
    setIsLoadingBalance(false);

    // Cancel in-flight queries
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
  }, []);

  /**
   * Fetches fresh balance for the connected wallet with session-generation protection.
   * Ensures responses from disconnected or previously active wallets are discarded.
   */
  const fetchBalance = useCallback(
    async (forceFresh: boolean = false): Promise<number | null> => {
      if (!currentWalletKey) {
        invalidateBalanceCache();
        return null;
      }

      // 1. Check valid wallet-scoped cache unless forceFresh is requested
      const now = Date.now();
      const existing = cachedBalanceRef.current;
      if (
        !forceFresh &&
        existing &&
        existing.publicKey === currentWalletKey &&
        now - existing.fetchedAt < cacheTtlMs
      ) {
        setBalance(existing.sol);
        setBalanceLamports(existing.lamports);
        return existing.lamports;
      }

      // 2. Abort previous in-flight request and bump session generation
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      activeAbortControllerRef.current = controller;

      sessionGenRef.current += 1;
      const currentGen = sessionGenRef.current;
      const targetWallet = currentWalletKey;

      setIsLoadingBalance(true);
      setBalanceError(null);

      try {
        const connection = new Connection(rpcUrl, "confirmed");
        const pubkey = new PublicKey(targetWallet);
        const lamports = await connection.getBalance(pubkey);

        // Discard stale responses if wallet changed or aborted in the interim
        if (
          controller.signal.aborted ||
          sessionGenRef.current !== currentGen ||
          activeWalletRef.current !== targetWallet
        ) {
          return null;
        }

        const sol = lamports / 1e9;
        const entry: WalletBalanceCacheEntry = {
          publicKey: targetWallet,
          lamports,
          sol,
          fetchedAt: Date.now(),
        };

        cachedBalanceRef.current = entry;
        setBalance(sol);
        setBalanceLamports(lamports);
        setIsLoadingBalance(false);
        return lamports;
      } catch (err: any) {
        if (controller.signal.aborted || sessionGenRef.current !== currentGen) {
          return null;
        }
        setIsLoadingBalance(false);
        const errMsg = err?.message || "Failed to fetch wallet balance";
        setBalanceError(errMsg);
        return null;
      }
    },
    [currentWalletKey, rpcUrl, cacheTtlMs, invalidateBalanceCache]
  );

  /**
   * Preflight check: ensures current wallet has required lamports prior to transaction.
   * Guarantees balance is fresh and matches current wallet public key.
   */
  const checkBalancePreflight = useCallback(
    async (requiredLamports: number): Promise<PreflightCheckResult> => {
      if (!currentWalletKey) {
        return {
          allowed: false,
          balanceLamports: 0,
          requiredLamports,
          error: "Wallet is not connected.",
        };
      }

      const currentLamports = await fetchBalance(true);
      if (currentLamports === null) {
        return {
          allowed: false,
          balanceLamports: 0,
          requiredLamports,
          error: balanceError || "Unable to determine current wallet balance for preflight.",
        };
      }

      if (currentLamports < requiredLamports) {
        return {
          allowed: false,
          balanceLamports: currentLamports,
          requiredLamports,
          error: `Insufficient balance. Required: ${requiredLamports / 1e9} SOL, Available: ${
            currentLamports / 1e9
          } SOL.`,
        };
      }

      return {
        allowed: true,
        balanceLamports: currentLamports,
        requiredLamports,
      };
    },
    [currentWalletKey, fetchBalance, balanceError]
  );

  // Synchronously react to wallet changes, disconnects, and reconnects
  useEffect(() => {
    const prevWallet = activeWalletRef.current;
    activeWalletRef.current = currentWalletKey;

    if (prevWallet !== currentWalletKey) {
      // Wallet switched, disconnected, or reconnected
      sessionGenRef.current += 1;
      invalidateBalanceCache();

      if (currentWalletKey) {
        // Automatically fetch fresh balance for new wallet
        fetchBalance(true);
      }
    }
  }, [currentWalletKey, invalidateBalanceCache, fetchBalance]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionGenRef.current += 1;
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, []);

  const executeEscrowTransaction = async (
    transaction: Transaction,
    sendTransactionFn: (tx: Transaction) => Promise<string>,
    requiredLamports?: number
  ) => {
    setStatus("simulating");
    setErrorMessage(null);

    // Optional preflight check if requiredLamports is supplied
    if (requiredLamports !== undefined) {
      const preflight = await checkBalancePreflight(requiredLamports);
      if (!preflight.allowed) {
        setStatus("error");
        setErrorMessage(preflight.error || "Preflight balance check failed.");
        return { success: false, error: preflight.error };
      }
    }

    const connection = new Connection(rpcUrl, "confirmed");

    // 1. Client-Side RPC Simulation (<50ms)
    const simResult = await simulateEscrowTransaction(connection, transaction);

    if (!simResult.success) {
      setStatus("error");
      setErrorMessage(simResult.error || "Transaction simulation failed (e.g. slippage exceeded).");
      return { success: false, error: simResult.error };
    }

    // 2. Submit transaction to RPC nodes & Apply Optimistic UI Transition (<50ms)
    try {
      const signature = await sendTransactionFn(transaction);
      setPendingSignature(signature);
      setStatus("confirmed_optimistic");

      // Invalidate balance cache after submission since transaction alters lamports
      invalidateBalanceCache();

      // 3. Background Signature Reconciliation Worker
      reconcilePendingSignature({ signature, connection }).then((isFinalized) => {
        if (isFinalized) {
          setStatus("finalized");
          // Refresh balance after finalization
          if (currentWalletKey) {
            fetchBalance(true);
          }
        } else {
          // Revert optimistic mutation on on-chain drop / blockhash expiration
          setStatus("error");
          setErrorMessage("Transaction dropped or expired on-chain. Please retry.");
        }
      });

      return { success: true, signature };
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to submit transaction.");
      return { success: false, error: err.message };
    }
  };

  return {
    status,
    errorMessage,
    pendingSignature,
    balance,
    balanceLamports,
    isLoadingBalance,
    balanceError,
    fetchBalance,
    invalidateBalanceCache,
    checkBalancePreflight,
    executeEscrowTransaction,
  };
}
