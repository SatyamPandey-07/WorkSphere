"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

interface StudentDiscountVerificationProps {
  /** Called after the proof is accepted and the user is verified server-side. */
  onVerified?: () => void;
}

function createZkpWorker(): Worker {
  return new Worker(
    new URL("../../workers/zkpWorker.ts", import.meta.url),
  );
}

export function StudentDiscountVerification({
  onVerified,
}: StudentDiscountVerificationProps) {
  const [studentId, setStudentId] = useState("");
  const [isProving, setIsProving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  });

  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  const spawnWorker = useCallback(() => {
    terminateWorker();
    const worker = createZkpWorker();

    worker.onmessage = async (e) => {
      const { type, proof, publicSignals, error: workerError } = e.data;

      if (type === "error") {
        setIsProving(false);
        setError(workerError || "Failed to generate zero-knowledge proof");
        // Terminate the worker after failure so snarkjs WASM resources are freed
        terminateWorker();
        return;
      }

      if (type === "success") {
        setIsVerifying(true);
        try {
          const response = await fetch("/api/user/verify-student", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proof, publicSignals }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Verification failed");
          }

          setIsSuccess(true);
          onVerifiedRef.current?.();
        } catch (err: any) {
          setError(err.message);
          // Terminate the worker after API failure to free resources
          terminateWorker();
        } finally {
          setIsProving(false);
          setIsVerifying(false);
        }
      }
    };

    worker.onerror = () => {
      setIsProving(false);
      setError("Worker crashed during proof generation");
      terminateWorker();
    };

    workerRef.current = worker;
    return worker;
  }, [terminateWorker]);

  useEffect(() => {
    spawnWorker();
    return () => {
      terminateWorker();
    };
  }, [spawnWorker, terminateWorker]);

  const handleVerify = () => {
    if (!studentId) return;
    setError(null);
    setIsProving(true);

    try {
      const t = BigInt(studentId.replace(/\D/g, "") || "0");
      const expectedCommit = (t * t + BigInt(5) * t + BigInt(17)).toString();

      // If worker was terminated (after previous error), respawn it
      if (!workerRef.current) {
        spawnWorker();
      }

      workerRef.current?.postMessage({
        identityToken: t.toString(),
        expectedCommit,
      });
    } catch {
      setError("Invalid Student ID format");
      setIsProving(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="w-full max-w-md mx-auto rounded-xl border border-green-500/50 bg-green-500/5 p-6 shadow-sm">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-6 h-6 text-green-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2 text-foreground">
            Student Status Verified
          </h3>
          <p className="text-sm text-muted-foreground">
            Your student identity has been verified without revealing your ID.
            You now have access to the student discount!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col space-y-1.5 p-6">
        <h3 className="text-2xl font-semibold leading-none tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          Verify Student Status
        </h3>
        <p className="text-sm text-muted-foreground">
          We use Zero-Knowledge Proofs to verify your student ID on your device.
          Your private ID never leaves your browser.
        </p>
      </div>
      <div className="p-6 pt-0">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="student-id" className="text-sm font-medium">
              Numeric Student ID
            </label>
            <Input
              id="student-id"
              placeholder="e.g. 12345678"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              disabled={isProving || isVerifying}
              type="number"
            />
          </div>
          {error && (
            <div className="text-sm text-red-500 font-medium">{error}</div>
          )}
        </div>
      </div>
      <div className="flex items-center p-6 pt-0">
        <Button
          className="w-full"
          onClick={handleVerify}
          disabled={!studentId || isProving || isVerifying}
        >
          {isProving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating ZKP Locally...
            </>
          ) : isVerifying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying Proof...
            </>
          ) : (
            "Verify with zk-SNARK"
          )}
        </Button>
      </div>
    </div>
  );
}
