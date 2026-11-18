"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export type ZkpProgressStage =
  | "idle"
  | "preparing"
  | "generating_witness"
  | "computing_proof"
  | "retrying"
  | "verifying"
  | "complete"
  | "error";

export type ZkpCircuitType = "primary" | "fallback";

export interface StudentProofInputs {
  studentId?: string;
  secret: string;
  epoch: string | number;
  root: string;
  pathElements: string[];
  pathIndices: number[];
}

export interface ZkpStudentProofResult {
  proof: any;
  publicSignals: string[];
  circuitType: ZkpCircuitType;
  attemptsUsed: number;
  executionDurationMs: number;
}

export interface UseZkpStudentProofOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  backoffMultiplier?: number;
  timeoutMs?: number;
  workerFactory?: () => Worker;
  onProgress?: (stage: ZkpProgressStage, percent: number, message: string) => void;
  onSuccess?: (result: ZkpStudentProofResult) => void;
  onError?: (error: Error) => void;
}

export interface UseZkpStudentProofReturn {
  isProving: boolean;
  progress: number; // 0 - 100
  progressStage: ZkpProgressStage;
  statusMessage: string;
  attempt: number;
  maxRetries: number;
  circuitType: ZkpCircuitType;
  error: Error | null;
  result: ZkpStudentProofResult | null;
  generateProof: (inputs: StudentProofInputs) => Promise<ZkpStudentProofResult>;
  cancel: () => void;
  reset: () => void;
}

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_BACKOFF_MS = 1000;
export const DEFAULT_BACKOFF_MULTIPLIER = 2;
export const DEFAULT_TIMEOUT_MS = 15_000;

function createDefaultZkpWorker(): Worker {
  return new Worker(new URL("../workers/zkpWorker.ts", import.meta.url));
}

export function isRetryableZkpError(error: unknown): boolean {
  if (!error) return false;
  const msg = String(
    error instanceof Error ? error.message : typeof error === "object" ? (error as any).error || (error as any).details || error : error,
  ).toLowerCase();

  return (
    msg.includes("out of memory") ||
    msg.includes("memory access out of bounds") ||
    msg.includes("allocation failed") ||
    msg.includes("cannot allocate") ||
    msg.includes("oom") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("verification_timeout") ||
    msg.includes("proving_timeout") ||
    msg.includes("worker terminated") ||
    Boolean((error as any)?.isOom) ||
    Boolean((error as any)?.isTimeout)
  );
}

export function computeExponentialBackoffDelay(
  attempt: number,
  initialBackoffMs: number = DEFAULT_INITIAL_BACKOFF_MS,
  multiplier: number = DEFAULT_BACKOFF_MULTIPLIER,
): number {
  if (attempt <= 1) return initialBackoffMs;
  return initialBackoffMs * Math.pow(multiplier, attempt - 1);
}

export function useZkpStudentProof(
  options: UseZkpStudentProofOptions = {},
): UseZkpStudentProofReturn {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    workerFactory = createDefaultZkpWorker,
    onProgress,
    onSuccess,
    onError,
  } = options;

  const [isProving, setIsProving] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<ZkpProgressStage>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("Ready to verify");
  const [attempt, setAttempt] = useState<number>(0);
  const [circuitType, setCircuitType] = useState<ZkpCircuitType>("primary");
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<ZkpStudentProofResult | null>(null);

  const activeWorkerRef = useRef<Worker | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCancelledRef = useRef<boolean>(false);

  const updateStatus = useCallback(
    (stage: ZkpProgressStage, percent: number, message: string) => {
      setProgressStage(stage);
      setProgress(percent);
      setStatusMessage(message);
      onProgress?.(stage, percent, message);
    },
    [onProgress],
  );

  const terminateActiveWorker = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (backoffTimerRef.current) {
      clearTimeout(backoffTimerRef.current);
      backoffTimerRef.current = null;
    }
    if (activeWorkerRef.current) {
      try {
        activeWorkerRef.current.postMessage({ type: "abort" });
      } catch {
        // Ignore if already terminated
      }
      try {
        activeWorkerRef.current.terminate();
      } catch {
        // Ignore termination errors
      }
      activeWorkerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    isCancelledRef.current = true;
    terminateActiveWorker();
    setIsProving(false);
    updateStatus("idle", 0, "Proof generation cancelled");
  }, [terminateActiveWorker, updateStatus]);

  const reset = useCallback(() => {
    cancel();
    setAttempt(0);
    setCircuitType("primary");
    setError(null);
    setResult(null);
    updateStatus("idle", 0, "Ready to verify");
  }, [cancel, updateStatus]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      terminateActiveWorker();
    };
  }, [terminateActiveWorker]);

  const executeSingleAttempt = useCallback(
    (
      inputs: StudentProofInputs,
      currentCircuit: ZkpCircuitType,
      currentAttemptNum: number,
    ): Promise<{ proof: any; publicSignals: string[] }> => {
      return new Promise((resolve, reject) => {
        terminateActiveWorker();

        let worker: Worker;
        try {
          worker = workerFactory();
          activeWorkerRef.current = worker;
        } catch (workerInitErr) {
          return reject(workerInitErr);
        }

        updateStatus(
          "preparing",
          15,
          currentCircuit === "fallback"
            ? `Initializing lightweight fallback circuit (Attempt ${currentAttemptNum}/${maxRetries})...`
            : `Initializing snarkjs ZKP worker (Attempt ${currentAttemptNum}/${maxRetries})...`,
        );

        // Arm per-attempt timeout guard
        timeoutTimerRef.current = setTimeout(() => {
          if (activeWorkerRef.current === worker) {
            terminateActiveWorker();
            reject(
              new Error(
                `ZKP proof generation timed out after ${Math.round(timeoutMs / 1000)}s`,
              ),
            );
          }
        }, timeoutMs);

        worker.onmessage = (e: MessageEvent) => {
          if (isCancelledRef.current) return;
          const data = e.data || {};

          if (data.type === "progress") {
            const mappedPercent = Math.min(95, Math.max(20, data.percent || 50));
            updateStatus(
              data.stage === "witness" ? "generating_witness" : "computing_proof",
              mappedPercent,
              data.message || `Generating zero-knowledge proof (${mappedPercent}%)...`,
            );
            return;
          }

          if (data.type === "error") {
            terminateActiveWorker();
            const err = new Error(data.error || data.details || "Worker error occurred");
            (err as any).isOom = data.isOom;
            (err as any).isTimeout = data.isTimeout;
            reject(err);
            return;
          }

          if (data.type === "success") {
            terminateActiveWorker();
            updateStatus("complete", 100, "Cryptographic proof successfully generated!");
            resolve({
              proof: data.proof,
              publicSignals: data.publicSignals || [],
            });
            return;
          }
        };

        worker.onerror = (errEvent: ErrorEvent) => {
          terminateActiveWorker();
          reject(new Error(errEvent.message || "Unknown ZKP Worker error"));
        };

        // Dispatch job to worker
        // Simulate witness step milestone update
        setTimeout(() => {
          if (!isCancelledRef.current && activeWorkerRef.current === worker) {
            updateStatus(
              "generating_witness",
              45,
              "Computing Merkle membership witness...",
            );
          }
        }, 150);

        setTimeout(() => {
          if (!isCancelledRef.current && activeWorkerRef.current === worker) {
            updateStatus(
              "computing_proof",
              80,
              "Synthesizing Groth16 zero-knowledge proof...",
            );
          }
        }, 350);

        worker.postMessage({
          type: "prove-student",
          secret: inputs.secret,
          epoch: inputs.epoch,
          root: inputs.root,
          pathElements: inputs.pathElements,
          pathIndices: inputs.pathIndices,
          circuit: currentCircuit,
          useFallbackCircuit: currentCircuit === "fallback",
        });
      });
    },
    [maxRetries, timeoutMs, workerFactory, terminateActiveWorker, updateStatus],
  );

  const generateProof = useCallback(
    async (inputs: StudentProofInputs): Promise<ZkpStudentProofResult> => {
      isCancelledRef.current = false;
      setIsProving(true);
      setError(null);
      setResult(null);

      const startTime = Date.now();
      let activeCircuit: ZkpCircuitType = "primary";
      let lastEncounteredError: Error = new Error("Unknown proof generation error");

      for (let currentAttempt = 1; currentAttempt <= maxRetries; currentAttempt++) {
        if (isCancelledRef.current) {
          throw new Error("Proof generation was cancelled");
        }

        setAttempt(currentAttempt);
        setCircuitType(activeCircuit);

        try {
          const outcome = await executeSingleAttempt(inputs, activeCircuit, currentAttempt);

          const finalResult: ZkpStudentProofResult = {
            proof: outcome.proof,
            publicSignals: outcome.publicSignals,
            circuitType: activeCircuit,
            attemptsUsed: currentAttempt,
            executionDurationMs: Date.now() - startTime,
          };

          setIsProving(false);
          setResult(finalResult);
          onSuccess?.(finalResult);
          return finalResult;
        } catch (err: any) {
          if (isCancelledRef.current) {
            throw new Error("Proof generation was cancelled");
          }

          lastEncounteredError = err instanceof Error ? err : new Error(String(err));
          const isRetryable = isRetryableZkpError(lastEncounteredError);

          // If we haven't exhausted our 3 retry stages and the error is transient/retryable:
          if (currentAttempt < maxRetries && isRetryable) {
            // Automatically switch to fallback lightweight circuit for subsequent retries
            activeCircuit = "fallback";
            setCircuitType("fallback");

            const delayMs = computeExponentialBackoffDelay(
              currentAttempt,
              initialBackoffMs,
              backoffMultiplier,
            );

            const delaySeconds = (delayMs / 1000).toFixed(1);
            updateStatus(
              "retrying",
              Math.min(30, currentAttempt * 10),
              `Memory limit or timeout encountered. Retrying with fallback circuit in ${delaySeconds}s (Attempt ${currentAttempt + 1}/${maxRetries})...`,
            );

            // Wait for exponential backoff delay before next stage
            await new Promise((resolve) => {
              backoffTimerRef.current = setTimeout(resolve, delayMs);
            });
          } else {
            // Unretryable error or all 3 retry stages exhausted
            break;
          }
        }
      }

      setIsProving(false);
      setError(lastEncounteredError);
      updateStatus(
        "error",
        0,
        `Proof generation failed after ${maxRetries} attempts: ${lastEncounteredError.message}`,
      );
      onError?.(lastEncounteredError);
      throw lastEncounteredError;
    },
    [
      maxRetries,
      initialBackoffMs,
      backoffMultiplier,
      executeSingleAttempt,
      updateStatus,
      onSuccess,
      onError,
    ],
  );

  return {
    isProving,
    progress,
    progressStage,
    statusMessage,
    attempt,
    maxRetries,
    circuitType,
    error,
    result,
    generateProof,
    cancel,
    reset,
  };
}
