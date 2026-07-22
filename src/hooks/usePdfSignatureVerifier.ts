"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  extractSignatures,
  getSignedBytes,
} from "@/lib/pdf-verify/pdfSignatureExtractor";
import { fetchCaRootsPem } from "@/lib/pdf-verify/caRoots";
import type {
  PdfSignatureInfo,
  SignatureVerificationResult,
  VerificationStatus,
  ByteRange,
  WorkerRequest,
  WorkerResponse,
} from "@/types/pdfSignature";

export interface UsePdfSignatureVerifierReturn {
  status: VerificationStatus;
  signatures: PdfSignatureInfo[];
  result: SignatureVerificationResult | null;
  error: string | null;
  verify: (file: File) => Promise<void>;
  reset: () => void;
}

let workerInstance: Worker | null = null;
let workerReady = false;
let initPromise: Promise<void> | null = null;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL("@/workers/pdfVerify.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return workerInstance;
}

async function initWorker(): Promise<void> {
  if (workerReady) return;
  if (initPromise) return initPromise;

  initPromise = new Promise<void>((resolve, reject) => {
    const worker = getWorker();
    const id = crypto.randomUUID();

    const handler = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== id) return;
      worker.removeEventListener("message", handler);

      if (e.data.action === "ready") {
        workerReady = true;
        resolve();
      } else {
        reject(new Error(e.data.error || "Worker init failed"));
      }
    };

    worker.addEventListener("message", handler);

    const wasmUrl = "/pdf-verify.js";
    worker.postMessage({
      action: "init",
      id,
      payload: { wasmUrl },
    } satisfies WorkerRequest);
  });

  return initPromise;
}

function verifyInWorker(
  pdfBytes: Uint8Array,
  cmsBlob: Uint8Array,
  byteRange: ByteRange,
  caRoots: string,
): Promise<SignatureVerificationResult> {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    const id = crypto.randomUUID();

    const handler = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== id) return;
      worker.removeEventListener("message", handler);

      if (e.data.action === "result" && e.data.result) {
        resolve(e.data.result);
      } else {
        reject(new Error(e.data.error || "Verification failed"));
      }
    };

    worker.addEventListener("message", handler);

    worker.postMessage({
      action: "verify",
      id,
      payload: { pdfBytes, cmsBlob, byteRange, caRoots },
    } satisfies WorkerRequest);
  });
}

export function usePdfSignatureVerifier(): UsePdfSignatureVerifierReturn {
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [signatures, setSignatures] = useState<PdfSignatureInfo[]>([]);
  const [result, setResult] = useState<SignatureVerificationResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setStatus("idle");
    setSignatures([]);
    setResult(null);
    setError(null);
  }, []);

  const verify = useCallback(async (file: File) => {
    abortRef.current = false;
    setStatus("loading");
    setResult(null);
    setError(null);
    setSignatures([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (abortRef.current) return;

      const pdfBytes = new Uint8Array(arrayBuffer);
      const foundSignatures = extractSignatures(pdfBytes);

      if (foundSignatures.length === 0) {
        setStatus("unsigned");
        return;
      }

      setSignatures(foundSignatures);
      setStatus("verifying");

      await initWorker();
      if (abortRef.current) return;

      const sig = foundSignatures[0];
      const signedBytes = getSignedBytes(pdfBytes, sig.byteRange);
      const caRoots = await fetchCaRootsPem();

      const verifyResult = await verifyInWorker(
        signedBytes,
        sig.contents,
        sig.byteRange,
        caRoots,
      );

      if (abortRef.current) return;

      setResult(verifyResult);
      setStatus(verifyResult.valid ? "verified" : "invalid");
    } catch (err) {
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
    }
  }, []);

  return { status, signatures, result, error, verify, reset };
}
