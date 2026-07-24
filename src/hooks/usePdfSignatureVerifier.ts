"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  PdfSignatureInfo,
  SignatureVerificationResult,
  VerificationStatus,
} from "@/types/pdfSignature";

export interface UsePdfSignatureVerifierReturn {
  status: VerificationStatus;
  progress: number;
  signatures: PdfSignatureInfo[];
  result: SignatureVerificationResult | null;
  error: string | null;
  verify: (file: File) => Promise<void>;
  reset: () => void;
}

export function usePdfSignatureVerifier(): UsePdfSignatureVerifierReturn {
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [signatures, setSignatures] = useState<PdfSignatureInfo[]>([]);
  const [result, setResult] = useState<SignatureVerificationResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current = true;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setStatus("idle");
    setProgress(0);
    setSignatures([]);
    setResult(null);
    setError(null);
  }, []);

  const verify = useCallback(async (file: File) => {
    abortRef.current = false;
    setStatus("loading");
    setProgress(0);
    setResult(null);
    setError(null);
    setSignatures([]);

    try {
      if (workerRef.current) {
        workerRef.current.terminate();
      }

      const worker = new Worker(
        new URL("../workers/pdfSignature.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (event) => {
        if (abortRef.current) return;

        const {
          type,
          progress: p,
          signatures: sigs,
          results,
          error: err,
        } = event.data;

        if (type === "progress") {
          setProgress(p);
          if (p === 50) {
            setStatus("verifying");
          }
        } else if (type === "result") {
          if (sigs && sigs.length === 0) {
            setStatus("unsigned");
            worker.terminate();
            workerRef.current = null;
            return;
          }
          if (results && results.length > 0) {
            const firstResult = results[0];
            setSignatures(results.map((r: any) => r.signature));
            setResult(firstResult.result);
            setStatus(firstResult.result.valid ? "verified" : "invalid");
          }
          worker.terminate();
          workerRef.current = null;
        } else if (type === "error") {
          setError(err || "Verification failed");
          setStatus("error");
          worker.terminate();
          workerRef.current = null;
        }
      };

      worker.onerror = (e) => {
        if (abortRef.current) return;
        setError("Worker error: " + e.message);
        setStatus("error");
        worker.terminate();
        workerRef.current = null;
      };

      const chunkSize = 1024 * 1024; // 1 MB
      const totalBytes = file.size;

      for (let i = 0; i < totalBytes; i += chunkSize) {
        if (abortRef.current) break;
        const blob = file.slice(i, i + chunkSize);
        const arrayBuffer = await blob.arrayBuffer();

        worker.postMessage(
          {
            type: "chunk",
            payload: { chunk: arrayBuffer },
          },
          [arrayBuffer],
        );

        const currentProgress = Math.floor(((i + blob.size) / totalBytes) * 40); // 0-40% for loading
        setProgress(currentProgress);
      }

      if (!abortRef.current) {
        worker.postMessage({ type: "verify" });
      }
    } catch (err) {
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
    }
  }, []);

  return { status, progress, signatures, result, error, verify, reset };
}
