"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  PdfSignatureInfo,
  SignatureVerificationResult,
  VerificationStatus,
} from "@/types/pdfSignature";
import { extractSignatures } from "@/lib/pdf-verify/pdfSignatureExtractor";
import { fetchCaRootsPem } from "@/lib/pdf-verify/caRoots";

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
        workerRef.current = null;
      }

      setProgress(10);
      const arrayBuffer = await file.arrayBuffer();
      if (abortRef.current) return;

      const pdfBytes = new Uint8Array(arrayBuffer);
      setProgress(30);

      const extractedSignatures = extractSignatures(pdfBytes);
      if (abortRef.current) return;

      if (extractedSignatures.length === 0) {
        setStatus("unsigned");
        setProgress(100);
        return;
      }

      setProgress(50);
      setSignatures(extractedSignatures);
      setStatus("verifying");

      const sig = extractedSignatures[0];
      const caRoots = await fetchCaRootsPem();
      if (abortRef.current) return;

      const worker = new Worker(
        new URL("../workers/pdfVerify.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (event) => {
        if (abortRef.current) return;

        const { action, result: res, error: err } = event.data;

        if (action === "ready") {
          worker.postMessage({
            action: "verify",
            id: "verify-1",
            payload: {
              pdfBytes,
              cmsBlob: sig.contents,
              byteRange: sig.byteRange,
              caRoots,
            },
          });
          setProgress(75);
        } else if (action === "result") {
          setProgress(100);
          if (res) {
            setResult(res);
            setStatus(res.valid ? "verified" : "invalid");
          }
          worker.terminate();
          workerRef.current = null;
        } else if (action === "error") {
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

      worker.postMessage({
        action: "init",
        id: "init-1",
        payload: { wasmUrl: "/pdf-verify.js" },
      });
    } catch (err) {
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
    }
  }, []);

  return { status, progress, signatures, result, error, verify, reset };
}
