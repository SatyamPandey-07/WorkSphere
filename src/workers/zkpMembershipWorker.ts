/**
 * Web Worker that generates and verifies anonymous paid-membership proofs.
 *
 * Proving runs off the main thread so the venue check-in UI stays responsive.
 * The identity secret and Merkle path exist only inside this worker's witness;
 * the response contains the Groth16 proof plus the two public signals
 * `[root, epoch]` and nothing else.
 *
 * Protocol
 * --------
 * Request:
 *   { type: "prove-membership", identitySecret, epoch, root,
 *     pathElements, pathIndices, timeoutMs? }
 *   { type: "verify-membership", proof, publicSignals, timeoutMs?,
 *     verificationKey? }          // key is fetched when omitted
 *   { type: "cancel" } | { type: "terminate" }
 *
 * Response:
 *   { type: "progress", stage: "witness" | "proving", percent }
 *   { type: "success", proof, publicSignals, durationMs }
 *   { type: "verify_result", isValid }
 *   { type: "error", error, code?, isTimeout?, isOom? }
 */

import * as snarkjs from "snarkjs";
import {
  MEMBERSHIP_VERIFICATION_KEY_URL,
  MEMBERSHIP_WASM_PATH,
  MEMBERSHIP_ZKEY_PATH,
  validateMembershipProofInput,
  type Groth16Proof,
} from "@/lib/zkp/membershipCircuit";

export const MEMBERSHIP_PROVING_TIMEOUT_MS = 30_000;
export const MEMBERSHIP_VERIFICATION_TIMEOUT_MS = 15_000;

export type MembershipWorkerErrorCode =
  | "INVALID_INPUT"
  | "PROVING_TIMEOUT"
  | "VERIFICATION_TIMEOUT"
  | "OOM"
  | "WORKER_ERROR";

export type MembershipWorkerRequest =
  | {
      type: "prove-membership" | "prove_membership" | "generate-membership-proof";
      identitySecret: string | number | bigint;
      epoch: string | number;
      root: string | number | bigint;
      pathElements: Array<string | number | bigint>;
      pathIndices: Array<string | number>;
      timeoutMs?: number;
    }
  | {
      type: "verify-membership";
      proof: Groth16Proof;
      publicSignals: string[];
      timeoutMs?: number;
      verificationKey?: unknown;
    }
  | { type: "cancel" | "terminate" | "abort" };

export type MembershipWorkerResponse =
  | { type: "progress"; stage: "witness" | "proving"; percent: number }
  | {
      type: "success";
      proof: Groth16Proof;
      publicSignals: string[];
      durationMs: number;
    }
  | { type: "verify_result"; isValid: boolean; durationMs: number }
  | {
      type: "error";
      error: string;
      code?: MembershipWorkerErrorCode;
      isTimeout?: boolean;
      isOom?: boolean;
    };

type PostFn = (message: MembershipWorkerResponse) => void;

let generation = 0;

/** Best-effort `postMessage` that is a no-op outside a worker thread. */
function defaultPost(message: MembershipWorkerResponse): void {
  const post = (globalThis as { postMessage?: PostFn }).postMessage;
  post?.(message);
}

export async function terminateMembershipCurve(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (!g.curve_bn128) return;

  try {
    await g.curve_bn128.terminate();
  } catch {
    // Cleanup must never mask the actual result.
  } finally {
    delete g.curve_bn128;
  }
}

export function classifyMembershipWorkerError(
  error: unknown,
): MembershipWorkerErrorCode {
  const message = (
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String((error as { message?: string })?.message ?? error)
  ).toLowerCase();

  if (message.includes("timeout") || message.includes("timed out")) {
    return message.includes("verification")
      ? "VERIFICATION_TIMEOUT"
      : "PROVING_TIMEOUT";
  }

  if (
    message.includes("out of memory") ||
    message.includes("memory access out of bounds") ||
    message.includes("allocation failed") ||
    message.includes("cannot allocate") ||
    message.includes("rangeerror")
  ) {
    return "OOM";
  }

  if (message.includes("invalid") || message.includes("must be")) {
    return "INVALID_INPUT";
  }

  return "WORKER_ERROR";
}

export function sanitizeMembershipWorkerError(error: unknown): string {
  switch (classifyMembershipWorkerError(error)) {
    case "PROVING_TIMEOUT":
      return "Proof generation timed out. Try again on a faster device.";
    case "VERIFICATION_TIMEOUT":
      return "Proof verification timed out.";
    case "OOM":
      return "Not enough memory to build the membership proof. Close other tabs and retry.";
    case "INVALID_INPUT":
      return error instanceof Error
        ? error.message
        : "Invalid membership proof inputs.";
    default:
      return "Membership proof operation failed.";
  }
}

function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([operation(), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isWorkerScope(): boolean {
  return (
    typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !==
      "undefined" &&
    typeof (globalThis as { addEventListener?: unknown }).addEventListener ===
      "function"
  );
}

/**
 * Handles one worker message. Exported so tests can drive the protocol without
 * spawning a real Worker.
 */
export async function handleMembershipWorkerMessage(
  message: MembershipWorkerRequest,
  post: PostFn = defaultPost,
): Promise<void> {
  if (!message || typeof message !== "object") {
    post({ type: "error", error: "Invalid worker message", code: "WORKER_ERROR" });
    return;
  }

  if (message.type === "cancel" || message.type === "terminate" || message.type === "abort") {
    generation += 1;
    await terminateMembershipCurve();
    if (message.type !== "cancel") {
      const close = (globalThis as { close?: () => void }).close;
      close?.();
    }
    return;
  }

  const myGeneration = ++generation;

  if (message.type === "verify-membership") {
    const timeoutMs = message.timeoutMs ?? MEMBERSHIP_VERIFICATION_TIMEOUT_MS;
    const startedAt = Date.now();

    try {
      let verificationKey = message.verificationKey;

      if (!verificationKey) {
        if (typeof fetch !== "function") {
          throw new Error("Fetch is unavailable in this worker");
        }
        const response = await fetch(MEMBERSHIP_VERIFICATION_KEY_URL);
        verificationKey = await response.json();
      }

      const isValid = await withTimeout(
        () =>
          snarkjs.groth16.verify(
            verificationKey as Parameters<typeof snarkjs.groth16.verify>[0],
            message.publicSignals,
            message.proof as Parameters<typeof snarkjs.groth16.verify>[2],
          ),
        timeoutMs,
        "Membership verification timed out",
      );

      if (myGeneration !== generation) return;
      post({ type: "verify_result", isValid, durationMs: Date.now() - startedAt });
    } catch (error) {
      if (myGeneration !== generation) return;
      const code = classifyMembershipWorkerError(error);
      post({
        type: "error",
        error: sanitizeMembershipWorkerError(error),
        code,
        isTimeout: code === "VERIFICATION_TIMEOUT",
      });
    } finally {
      await terminateMembershipCurve();
    }
    return;
  }

  // ── prove-membership ──────────────────────────────────────────────────────
  if (
    message.type !== "prove-membership" &&
    message.type !== "prove_membership" &&
    message.type !== "generate-membership-proof"
  ) {
    post({ type: "error", error: "Unknown worker message", code: "WORKER_ERROR" });
    return;
  }

  const proved = message;
  const validated = validateMembershipProofInput({
    identitySecret: proved.identitySecret,
    epoch: proved.epoch,
    root: proved.root,
    pathElements: proved.pathElements,
    pathIndices: proved.pathIndices,
  });

  if (!validated.valid || !validated.value) {
    post({
      type: "error",
      error: validated.error ?? "Invalid membership proof inputs",
      code: "INVALID_INPUT",
    });
    return;
  }

  const timeoutMs = proved.timeoutMs ?? MEMBERSHIP_PROVING_TIMEOUT_MS;
  const startedAt = Date.now();

  try {
    post({ type: "progress", stage: "witness", percent: 25 });

    const result = await withTimeout(
      () =>
        snarkjs.groth16.fullProve(
          validated.value as unknown as Record<string, unknown>,
          MEMBERSHIP_WASM_PATH,
          MEMBERSHIP_ZKEY_PATH,
        ),
      timeoutMs,
      "Membership proving timed out",
    );

    if (myGeneration !== generation) return;

    post({ type: "progress", stage: "proving", percent: 90 });
    post({
      type: "success",
      proof: result.proof as Groth16Proof,
      publicSignals: result.publicSignals as string[],
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (myGeneration !== generation) return;
    const code = classifyMembershipWorkerError(error);
    post({
      type: "error",
      error: sanitizeMembershipWorkerError(error),
      code,
      isTimeout: code === "PROVING_TIMEOUT",
      isOom: code === "OOM",
    });
  } finally {
    await terminateMembershipCurve();
  }
}

// Only attach the listener inside a real dedicated worker. Jest's jsdom sets
// `self === window`, and we do not want a global message handler in tests.
if (isWorkerScope()) {
  (globalThis as unknown as {
    addEventListener: (
      type: "message",
      listener: (event: MessageEvent<MembershipWorkerRequest>) => void,
    ) => void;
  }).addEventListener("message", (event) => {
    void handleMembershipWorkerMessage(event.data);
  });

  (globalThis as unknown as {
    addEventListener: (
      type: "unhandledrejection",
      listener: (event: PromiseRejectionEvent) => void,
    ) => void;
  }).addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    defaultPost({
      type: "error",
      error: sanitizeMembershipWorkerError(event.reason),
      code: classifyMembershipWorkerError(event.reason),
    });
  });
}
