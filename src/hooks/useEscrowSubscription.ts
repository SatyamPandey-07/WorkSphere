"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Connection, SignatureStatus } from "@solana/web3.js";
import {
  subscribeToEscrowConfirmation,
  type EscrowConfirmationStatus,
  type EscrowConfirmationSource,
  type EscrowConfirmationEvent,
  type EscrowConfirmationSubscription,
} from "@/lib/solana/escrowClient";

export interface UseEscrowSubscriptionOptions {
  connection?: Connection;
  commitment?: "processed" | "confirmed" | "finalized";
  confirmTimeoutMs?: number;
  finalizeTimeoutMs?: number;
  overallTimeoutMs?: number;
  initialPollDelayMs?: number;
  pollIntervalMs?: number;
  minPollIntervalMs?: number;
  maxPollIntervalMs?: number;
  pollBackoffMultiplier?: number;
  lastValidBlockHeight?: number;
  pollSignatureStatus?: (signature: string) => Promise<SignatureStatus | null>;
  onStatusChange?: (event: EscrowConfirmationEvent) => void;
  onProcessed?: (event: EscrowConfirmationEvent) => void;
  onConfirmed?: (event: EscrowConfirmationEvent) => void;
  onFinalized?: (event: EscrowConfirmationEvent) => void;
  onFallbackPolling?: (event: EscrowConfirmationEvent) => void;
  onError?: (error: Error, event: EscrowConfirmationEvent) => void;
  onTimeout?: (event: EscrowConfirmationEvent) => void;
  onWebSocketDisconnect?: (reason?: string) => void;
}

export interface UseEscrowSubscriptionResult {
  status: EscrowConfirmationStatus;
  source: EscrowConfirmationSource;
  slot: number | null;
  error: string | null;
  signature: string | null;
  isConfirming: boolean;
  isConfirmed: boolean;
  isFinalized: boolean;
  isFallbackPolling: boolean;
  isTerminal: boolean;
  subscribe: (signature: string, options?: UseEscrowSubscriptionOptions) => void;
  unsubscribe: () => void;
}

export function useEscrowSubscription(
  initialSignature?: string,
  initialOptions?: UseEscrowSubscriptionOptions,
): UseEscrowSubscriptionResult {
  const [currentSignature, setCurrentSignature] = useState<string | null>(
    initialSignature?.trim() || null,
  );
  const [status, setStatus] = useState<EscrowConfirmationStatus>("pending");
  const [source, setSource] = useState<EscrowConfirmationSource>("websocket");
  const [slot, setSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subscriptionRef = useRef<EscrowConfirmationSubscription | null>(null);
  const optionsRef = useRef<UseEscrowSubscriptionOptions | undefined>(initialOptions);
  optionsRef.current = initialOptions;

  const isMountedRef = useRef<boolean>(true);
  const activeSignatureRef = useRef<string | null>(currentSignature);
  const requestIdRef = useRef<number>(0);

  const unsubscribe = useCallback(() => {
    if (subscriptionRef.current) {
      try {
        subscriptionRef.current.unsubscribe();
      } catch {}
      subscriptionRef.current = null;
    }
  }, []);

  const subscribe = useCallback(
    (newSignature: string, overrideOptions?: UseEscrowSubscriptionOptions) => {
      if (!newSignature || typeof newSignature !== "string" || !newSignature.trim()) {
        return;
      }
      const cleanSig = newSignature.trim();
      requestIdRef.current += 1;
      const currentRequestId = requestIdRef.current;

      unsubscribe();

      activeSignatureRef.current = cleanSig;
      setCurrentSignature(cleanSig);
      setStatus("pending");
      setSource("websocket");
      setSlot(null);
      setError(null);

      const opts = overrideOptions ?? optionsRef.current ?? {};

      try {
        const sub = subscribeToEscrowConfirmation(cleanSig, {
          ...opts,
          confirmTimeoutMs: opts.confirmTimeoutMs,
          finalizeTimeoutMs: opts.finalizeTimeoutMs,
          overallTimeoutMs: opts.overallTimeoutMs,
          pollIntervalMs: opts.initialPollDelayMs ?? opts.pollIntervalMs,
          minPollIntervalMs: opts.minPollIntervalMs,
          maxPollIntervalMs: opts.maxPollIntervalMs,
          pollBackoffMultiplier: opts.pollBackoffMultiplier,
          lastValidBlockHeight: opts.lastValidBlockHeight,
          pollSignatureStatus: opts.pollSignatureStatus,
          onWebSocketDisconnect: (reason) => {
            if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
            opts.onWebSocketDisconnect?.(reason);
          },
          callbacks: {
            onStatusChange: (event) => {
              if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
              setStatus(event.status);
              setSource(event.source);
              if (event.slot !== undefined) setSlot(event.slot);
              if (event.error !== undefined) setError(event.error);
              opts.onStatusChange?.(event);
            },
            onProcessed: (event) => {
              if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
              opts.onProcessed?.(event);
            },
            onConfirmed: (event) => {
              if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
              opts.onConfirmed?.(event);
            },
            onFinalized: (event) => {
              if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
              opts.onFinalized?.(event);
            },
            onFallbackPolling: (event) => {
              if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
              opts.onFallbackPolling?.(event);
            },
            onError: (err, event) => {
              if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
              opts.onError?.(err, event);
            },
            onTimeout: (event) => {
              if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
              opts.onTimeout?.(event);
            },
          },
        });

        subscriptionRef.current = sub;
      } catch (err: any) {
        if (!isMountedRef.current || requestIdRef.current !== currentRequestId) return;
        setStatus("failed");
        setError(err?.message || "Failed to initiate subscription");
      }
    },
    [unsubscribe],
  );

  useEffect(() => {
    isMountedRef.current = true;

    if (initialSignature && initialSignature.trim()) {
      subscribe(initialSignature, initialOptions);
    }

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [initialSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const isTerminal = status === "finalized" || status === "failed" || status === "timeout";
  const isConfirming = status === "pending" || status === "processed" || status === "fallback_polling";
  const isConfirmed = status === "confirmed" || status === "finalized";
  const isFinalized = status === "finalized";
  const isFallbackPolling = status === "fallback_polling" || source === "http_polling";

  return {
    status,
    source,
    slot,
    error,
    signature: currentSignature,
    isConfirming,
    isConfirmed,
    isFinalized,
    isFallbackPolling,
    isTerminal,
    subscribe,
    unsubscribe,
  };
}
