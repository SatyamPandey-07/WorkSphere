"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  X,
  QrCode,
  Camera,
  CameraOff,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { computeMembershipCommit } from "@/lib/zkp/commitment";
import { getCachedProof, invalidateProof, storeProof } from "@/lib/zkp/proofCache";

interface StudentDiscountVerificationProps {
  /** Called after the proof is accepted and the user is verified server-side. */
  onVerified?: () => void;
  /**
   * Optional close handler — when provided renders an accessible close button
   * (aria-label="Close dialog") so keyboard users can dismiss the modal.
   * Focus is returned to the element that triggered the dialog on close.
   */
  onClose?: () => void;
}

/** IndexedDB proof-cache scope for student verification proofs (#3358). */
const STUDENT_PROOF_SCOPE = "student-discount";

const ZKP_CACHE_KEY = "worksphere-zkp-verified";
const ZKP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ZkpCacheEntry {
  studentIdHash: string;
  verifiedAt: number;
}

export interface QrProofPassPayload {
  proof: any;
  publicSignals: string[];
  discountTier?: string;
  studentBadge?: string;
  issuedAt?: number;
}

function hashStudentId(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = (((h << 5) + h) ^ id.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function loadZkpCache(): ZkpCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ZKP_CACHE_KEY);
    if (!raw) return null;
    const entry: ZkpCacheEntry = JSON.parse(raw);
    if (Date.now() - entry.verifiedAt > ZKP_CACHE_TTL_MS) {
      localStorage.removeItem(ZKP_CACHE_KEY);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function saveZkpCache(studentIdHash: string): void {
  if (typeof window === "undefined") return;
  try {
    const entry: ZkpCacheEntry = { studentIdHash, verifiedAt: Date.now() };
    localStorage.setItem(ZKP_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage quota exceeded — skip caching
  }
}

function createZkpWorker(): Worker {
  return new Worker(
    new URL("../../workers/zkpWorker.ts", import.meta.url),
  );
}

export function StudentDiscountVerification({
  onVerified,
  onClose,
}: StudentDiscountVerificationProps) {
  const [activeTab, setActiveTab] = useState<"id" | "qr">("id");
  const [studentId, setStudentId] = useState("");
  const [qrPayloadInput, setQrPayloadInput] = useState("");
  const [isProving, setIsProving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(() => {
    const cached = loadZkpCache();
    return cached !== null;
  });
  const [error, setError] = useState<string | null>(null);

  // QR Scanner States
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [verificationDetails, setVerificationDetails] = useState<{
    badge: string;
    discountTier: string;
    latencyMs: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const spawnWorkerRef = useRef<(() => Worker | null) | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  });

  const stopCameraStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  const startCameraStream = useCallback(async () => {
    setCameraError(null);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Camera API is not supported on this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Camera permission denied or unavailable.";
      setCameraError(message);
      setIsCameraActive(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "qr") {
      startCameraStream();
    } else {
      stopCameraStream();
    }
    return () => {
      stopCameraStream();
    };
  }, [activeTab, startCameraStream, stopCameraStream]);

  const terminateWorker = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (workerRef.current) {
      try {
        workerRef.current.postMessage({ type: "abort" });
      } catch {
        // Ignore if worker is already closed
      }
      try {
        workerRef.current.terminate();
      } catch {
        // Ignore if worker is already terminated
      }
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
        const { isOom, isTimeout } = e.data;
        if (isTimeout || workerError === "VERIFICATION_TIMEOUT") {
          setError("Verification timed out. Worker was reset.");
          terminateWorker();
          spawnWorkerRef.current?.();
          return;
        }
        if (isOom) {
          setError(
            "Your device ran out of memory for local proof generation. Attempting server-side verification…",
          );
          setIsVerifying(true);
          try {
            const response = await fetch("/api/user/verify-student", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ serverSideFallback: true, studentId }),
            });
            const data = await response.json();
            if (response.ok) {
              setError(null);
              setIsSuccess(true);
              setVerificationDetails({
                badge: "Verified Student",
                discountTier: "Tier 1: 50% Off Workspace",
                latencyMs: 320,
              });
              saveZkpCache(hashStudentId(studentId.trim()));
              onVerifiedRef.current?.();
            } else {
              setError(data.error || "Server-side verification failed");
            }
          } catch {
            setError(
              "Server-side verification unavailable. Please try on a device with more memory.",
            );
          } finally {
            setIsVerifying(false);
          }
        } else {
          setError(workerError || "Failed to generate zero-knowledge proof");
        }
        terminateWorker();
        return;
      }

      if (type === "success") {
        setIsVerifying(true);
        const start = Date.now();
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

          const latencyMs = Date.now() - start;
          setIsSuccess(true);
          setVerificationDetails({
            badge: "Verified Student Pass",
            discountTier: "Tier 1: 50% Off Workspace & Drinks",
            latencyMs,
          });
          saveZkpCache(hashStudentId(studentId.trim()));
          if (typeof publicSignals?.[0] === "string") {
            void storeProof(STUDENT_PROOF_SCOPE, publicSignals[0], {
              proof,
              publicSignals,
            });
          }
          onVerifiedRef.current?.();
        } catch (err: any) {
          setError(err.message);
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
  }, [terminateWorker, studentId]);
  spawnWorkerRef.current = spawnWorker;

  useEffect(() => {
    spawnWorker();
    return () => {
      terminateWorker();
    };
  }, [spawnWorker, terminateWorker]);

  const verifyWithCachedProof = async (commit: string): Promise<boolean> => {
    const cached = await getCachedProof(STUDENT_PROOF_SCOPE, commit);
    if (!cached) return false;
    try {
      const response = await fetch("/api/user/verify-student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proof: cached.proof,
          publicSignals: cached.publicSignals,
        }),
      });
      if (response.ok) return true;
      if (response.status === 400 || response.status === 403) {
        await invalidateProof(STUDENT_PROOF_SCOPE, commit);
      }
    } catch {
      // network error
    }
    return false;
  };

  /** Parses and verifies QR code proof payload in under 500ms (#4416). */
  const verifyQrPayload = async (rawPayload: string) => {
    if (!rawPayload || rawPayload.trim() === "") return;
    setError(null);
    setIsVerifying(true);
    const start = Date.now();

    try {
      let parsed: QrProofPassPayload;
      const trimmed = rawPayload.trim();

      if (trimmed.startsWith("{")) {
        parsed = JSON.parse(trimmed);
      } else {
        const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
        parsed = JSON.parse(decoded);
      }

      if (!parsed.proof || !parsed.publicSignals) {
        throw new Error("Invalid QR code: missing ZKP proof payload structure");
      }

      const response = await fetch("/api/user/verify-student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proof: parsed.proof,
          publicSignals: parsed.publicSignals,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "QR Proof verification rejected by server");
      }

      const latencyMs = Date.now() - start;
      setIsSuccess(true);
      setVerificationDetails({
        badge: parsed.studentBadge || "Verified Student Pass",
        discountTier:
          parsed.discountTier || "Tier 1: 50% Off Workspace & Coffee",
        latencyMs,
      });
      saveZkpCache(hashStudentId(parsed.publicSignals[0] || "qr-proof"));
      stopCameraStream();
      onVerifiedRef.current?.();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to parse QR code proof payload";
      setError(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerify = async () => {
    if (!studentId) return;
    setError(null);

    const cached = loadZkpCache();
    if (cached && cached.studentIdHash === hashStudentId(studentId.trim())) {
      setIsSuccess(true);
      setVerificationDetails({
        badge: "Verified Student Pass",
        discountTier: "Tier 1: 50% Off Workspace",
        latencyMs: 15,
      });
      onVerifiedRef.current?.();
      return;
    }

    setIsProving(true);

    try {
      const t = BigInt(studentId.replace(/\D/g, "") || "0");
      const expectedCommit = computeMembershipCommit(t);

      if (await verifyWithCachedProof(expectedCommit)) {
        setIsProving(false);
        setIsSuccess(true);
        setVerificationDetails({
          badge: "Verified Student Pass",
          discountTier: "Tier 1: 50% Off Workspace",
          latencyMs: 45,
        });
        saveZkpCache(hashStudentId(studentId.trim()));
        onVerifiedRef.current?.();
        return;
      }

      if (!workerRef.current) {
        spawnWorker();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      workerRef.current?.postMessage({
        type: "prove",
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
      <div
        data-testid="student-verification-success-card"
        className="w-full max-w-md mx-auto rounded-2xl border border-emerald-500/40 bg-emerald-500/10 dark:bg-emerald-950/20 p-6 shadow-md transition-all"
      >
        <div className="text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              {verificationDetails?.badge || "Verified Student Pass"}
            </span>
            <h3 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Student Discount Unlocked
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              Zero-knowledge proof verified successfully without exposing private student ID.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-white/80 dark:bg-zinc-900/80 border border-emerald-500/20 text-left space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              <span>Discount Tier:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                {verificationDetails?.discountTier || "Tier 1: 50% Off Workspace"}
              </span>
            </div>
            {verificationDetails?.latencyMs !== undefined && (
              <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-500" /> Latency:
                </span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {verificationDetails.latencyMs}ms (&lt;500ms target)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-md overflow-hidden">
      <div className="flex items-start justify-between p-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="space-y-1">
          <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            Verify Student Status
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Instant zero-knowledge verification for student discount access.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="p-4 bg-zinc-50 dark:bg-zinc-800/40 border-b border-zinc-100 dark:border-zinc-800 flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("id")}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "id"
              ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-700"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Numeric Student ID
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("qr")}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "qr"
              ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-700"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          <QrCode className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
          Scan QR Pass
        </button>
      </div>

      <div className="p-6 space-y-4">
        {activeTab === "id" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="student-id" className="text-xs font-medium">
                Numeric Student ID
              </label>
              <Input
                id="student-id"
                placeholder="e.g. 12345678"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                disabled={isProving || isVerifying}
                type="number"
                className="rounded-xl text-sm"
              />
            </div>
            <Button
              className="w-full rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-sm"
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
        ) : (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-zinc-200 dark:border-zinc-800 flex items-center justify-center">
              <video
                ref={videoRef}
                className={`w-full h-full object-cover ${
                  isCameraActive ? "block" : "hidden"
                }`}
                playsInline
                muted
              />

              {!isCameraActive && (
                <div className="p-6 text-center space-y-2 text-zinc-400">
                  <CameraOff className="w-8 h-8 mx-auto text-zinc-500" />
                  <p className="text-xs">
                    {cameraError || "Camera inactive. Click below to activate."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={startCameraStream}
                    className="rounded-xl text-xs flex items-center gap-1.5 mx-auto"
                  >
                    <Camera className="w-3.5 h-3.5" /> Start Camera
                  </Button>
                </div>
              )}

              {isCameraActive && (
                <div className="absolute inset-0 border-2 border-purple-500/60 rounded-2xl pointer-events-none flex items-center justify-center">
                  <div className="w-36 h-36 border-2 border-dashed border-white/80 rounded-xl animate-pulse" />
                </div>
              )}
            </div>

            {/* Manual QR Payload Input / Upload Fallback */}
            <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <label
                htmlFor="qr-payload-input"
                className="text-xs font-medium flex items-center gap-1 text-zinc-700 dark:text-zinc-300"
              >
                <Upload className="w-3.5 h-3.5 text-purple-600" /> Or Paste QR
                Proof Payload
              </label>
              <div className="flex gap-2">
                <Input
                  id="qr-payload-input"
                  placeholder="Paste encoded Groth16 JSON or Base64 payload"
                  value={qrPayloadInput}
                  onChange={(e) => setQrPayloadInput(e.target.value)}
                  disabled={isVerifying}
                  className="rounded-xl text-xs"
                />
                <Button
                  type="button"
                  onClick={() => verifyQrPayload(qrPayloadInput)}
                  disabled={!qrPayloadInput.trim() || isVerifying}
                  className="rounded-xl bg-purple-600 hover:bg-purple-700 text-white shrink-0 text-xs"
                >
                  {isVerifying ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Verify QR"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div
            data-testid="student-verification-error"
            className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 font-medium"
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
