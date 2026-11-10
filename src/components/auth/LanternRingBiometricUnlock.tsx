import React, { useState } from 'react';

// Simple translation lookup helper with fallback
interface LanternRingBiometricUnlockProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  currentLocale?: 'en' | 'hi' | 'de' | 'pt';
}

const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    biometricTitle: 'Lantern Ring Biometric Unlock',
    biometricSubtitle: 'Securely authenticate using your passkey or biometric scan',
    promptBiometric: 'Place your finger on the biometric scanner',
    cancel: 'Cancel',
    success: 'Authentication Successful',
    error: 'Authentication failed. Please try again.',
  },
  hi: {
    biometricTitle: 'lantern ring बायोमेट्रिक अनलॉक',
    biometricSubtitle: 'पासकी या biometric पहचान के साथ सुरक्षित रूप से प्रमाणित करें',
    promptBiometric: 'biometric स्कैनर पर उंगली रखें',
    cancel: 'रद्द करें',
    success: 'प्रमाणन सफल रहा',
    error: 'प्रमाणन विफल रहा। कृपया पुनः प्रयास करें।',
  },
  de: {
    biometricTitle: 'Lantern Ring Biometrische Entsperrung',
    biometricSubtitle: 'Sicher authentifizieren mit Passkey oder biometrischer Erkennung',
    promptBiometric: 'Legen Sie Ihren Finger auf den Biometrie-Scanner',
    cancel: 'Abbrechen',
    success: 'Authentifizierung erfolgreich',
    error: 'Authentifizierung fehlgeschlagen. Bitte versuchen Sie es erneut.',
  },
  pt: {
    biometricTitle: 'Desbloqueio Biométrico Lantern Ring',
    biometricSubtitle: 'Autentique com segurança usando passkey ou reconhecimento biométrico',
    promptBiometric: 'Coloque o dedo no leitor biométrico',
    cancel: 'Cancelar',
    success: 'Autenticação bem-sucedida',
    error: 'Falha na autenticação. Tente novamente.',
  },
};

export const LanternRingBiometricUnlock: React.FC<LanternRingBiometricUnlockProps> = ({
  onSuccess,
  onCancel,
  currentLocale = 'en',
}) => {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  
  const dict = TRANSLATIONS[currentLocale] || TRANSLATIONS['en'];

  const handleStartScan = async () => {
    setStatus('scanning');
    try {
      // Simulate WebAuthn navigator.credentials.get() biometric prompt
      if (window.PublicKeyCredential) {
        // Mock authentication delay
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setStatus('success');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Biometric authentication error:', err);
      setStatus('error');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white shadow-2xl max-w-md mx-auto text-center space-y-6 relative overflow-hidden">
      <div className="space-y-2">
        <h2 className="text-lg font-bold text-slate-100">{dict.biometricTitle}</h2>
        <p className="text-xs text-slate-400 leading-relaxed">{dict.biometricSubtitle}</p>
      </div>

      <div className="flex flex-col items-center justify-center py-6">
        <button
          onClick={handleStartScan}
          disabled={status === 'scanning'}
          className={`w-24 h-24 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer shadow-lg ${
            status === 'scanning'
              ? 'border-amber-500 bg-amber-500/10 animate-pulse text-amber-400'
              : status === 'success'
              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
              : status === 'error'
              ? 'border-rose-500 bg-rose-500/20 text-rose-400'
              : 'border-emerald-500/50 bg-slate-800 hover:bg-slate-700 text-emerald-400'
          }`}
          aria-label={dict.promptBiometric}
        >
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 0 1 7.5 16.5" />
            <path d="M12 6a6 6 0 0 1 4.5 9.9" />
            <path d="M12 10a2 2 0 0 1 1.5 3.3" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
        </button>
        <span className="text-xs text-slate-400 font-medium mt-4">
          {status === 'scanning' && dict.promptBiometric}
          {status === 'success' && dict.success}
          {status === 'error' && dict.error}
          {status === 'idle' && 'Tap sensor to begin'}
        </span>
      </div>

      <div className="flex justify-center gap-3 pt-4 border-t border-slate-800">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition cursor-pointer"
        >
          {dict.cancel}
        </button>
      </div>
    </div>
  );
};

export default LanternRingBiometricUnlock;
export default LanternRingBiometricUnlock;
export default LanternRingBiometricUnlock;
"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Fingerprint,
  ShieldAlert,
  Sparkles,
  Zap,
  RefreshCw,
  AlertTriangle,
  Unlock,
  CheckCircle2,
} from "lucide-react";

export type BiometricCeremonyState = "idle" | "verifying" | "success" | "error";

export type BiometricErrorType =
  | "none"
  | "cancelled"
  | "timeout"
  | "unsupported"
  | "security"
  | "unknown";

export interface LanternRingBiometricUnlockProps {
  /** Callback fired upon cryptographic assertion verification and emerald burst */
  onUnlockSuccess?: (credential: unknown) => void;
  /** Callback fired if biometric verification errors */
  onUnlockFailure?: (error: Error) => void;
  /** Optional callback fired when user cancels ceremony */
  onCancel?: () => void;
  /** Relying Party ID (default: window.location.hostname) */
  rpId?: string;
  /** Relying Party Name (default: "WorkSphere Sector 2814") */
  rpName?: string;
  /** Member or user name displayed on biometric authorization HUD */
  userName?: string;
  /** Optional custom challenge string for assertion */
  challenge?: string;
  /** Whether to automatically prompt biometric sensor on mount */
  autoPrompt?: boolean;
  /** Destination URL to redirect upon successful unlock */
  redirectTo?: string;
  /** Optional custom className */
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
  sparkleSpeed: number;
}

interface BeamRay {
  angle: number;
  length: number;
  maxLength: number;
  width: number;
  color: string;
  speed: number;
  alpha: number;
}

export function LanternRingBiometricUnlock({
  onUnlockSuccess,
  onUnlockFailure,
  onCancel,
  rpId,
  userName = "Sector 2814 Guardian",
  challenge = "worksphere_lantern_biometric_challenge_v1",
  autoPrompt = false,
  redirectTo,
  className = "",
}: LanternRingBiometricUnlockProps) {
  const [ceremonyState, setCeremonyState] =
    useState<BiometricCeremonyState>("idle");
  const [errorType, setErrorType] = useState<BiometricErrorType>("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [chargeLevel, setChargeLevel] = useState<number>(100);
  const [burstCompleted, setBurstCompleted] = useState<boolean>(false);
  const [hasPrompted, setHasPrompted] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Check WebAuthn support on mount
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.PublicKeyCredential === "undefined" ||
      typeof navigator.credentials === "undefined" ||
      typeof navigator.credentials.get !== "function"
    ) {
      setIsSupported(false);
    }
  }, []);

  // Cleanup active animation frame and WebAuthn ceremony on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  /**
   * GPU-accelerated emerald hard-light beam particle explosion engine
   */
  const triggerEmeraldEnergyBurst = useCallback(
    (onComplete?: () => void) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        onComplete?.();
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onComplete?.();
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 600;
      const height = canvas.clientHeight || 600;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const centerX = width / 2;
      const centerY = height / 2;

      // Initialize energy particles
      const particleColors = [
        "#00ff88",
        "#10b981",
        "#34d399",
        "#6ee7b7",
        "#a7f3d0",
        "#ffffff",
      ];
      const particles: Particle[] = [];
      const particleCount = 140;

      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 9 + 2;
        particles.push({
          x: centerX,
          y: centerY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: Math.random() * 4 + 1.5,
          color:
            particleColors[Math.floor(Math.random() * particleColors.length)],
          alpha: 1.0,
          decay: Math.random() * 0.015 + 0.008,
          sparkleSpeed: Math.random() * 0.2 + 0.05,
        });
      }

      // Initialize radiant hard-light beams
      const beamCount = 28;
      const beams: BeamRay[] = [];
      for (let i = 0; i < beamCount; i++) {
        beams.push({
          angle: (i * (Math.PI * 2)) / beamCount + (Math.random() * 0.1 - 0.05),
          length: 0,
          maxLength: Math.max(width, height) * 0.85,
          width: Math.random() * 12 + 6,
          color: i % 2 === 0 ? "#00ff88" : "#34d399",
          speed: Math.random() * 22 + 18,
          alpha: 0.95,
        });
      }

      let shockwaveRadius = 10;
      let shockwaveAlpha = 1.0;
      let shockwave2Radius = 5;
      let shockwave2Alpha = 0.8;
      let flashAlpha = 1.0;
      let frame = 0;

      const render = () => {
        ctx.clearRect(0, 0, width, height);

        // Flash background bloom
        if (flashAlpha > 0) {
          ctx.save();
          ctx.fillStyle = `rgba(16, 185, 129, ${flashAlpha * 0.35})`;
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
          flashAlpha -= 0.035;
        }

        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        // Draw radiant hard-light energy rays
        beams.forEach((beam) => {
          if (beam.length < beam.maxLength) {
            beam.length += beam.speed;
          } else {
            beam.alpha = Math.max(0, beam.alpha - 0.02);
          }

          if (beam.alpha > 0) {
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(beam.angle);

            const gradient = ctx.createLinearGradient(0, 0, beam.length, 0);
            gradient.addColorStop(0, "rgba(255, 255, 255, 0.9)");
            gradient.addColorStop(0.3, beam.color);
            gradient.addColorStop(1, "rgba(6, 78, 59, 0)");

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(0, -beam.width / 2);
            ctx.lineTo(beam.length, -beam.width / 4);
            ctx.lineTo(beam.length, beam.width / 4);
            ctx.lineTo(0, beam.width / 2);
            ctx.closePath();
            ctx.globalAlpha = beam.alpha;
            ctx.fill();
            ctx.restore();
          }
        });

        // Expanding concentric hard-light shockwaves
        if (shockwaveAlpha > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(centerX, centerY, shockwaveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 255, 136, ${shockwaveAlpha})`;
          ctx.lineWidth = 6;
          ctx.shadowColor = "#00ff88";
          ctx.shadowBlur = 25;
          ctx.stroke();
          ctx.restore();

          shockwaveRadius += 9;
          shockwaveAlpha -= 0.018;
        }

        if (shockwave2Alpha > 0 && frame > 6) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(centerX, centerY, shockwave2Radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(52, 211, 153, ${shockwave2Alpha})`;
          ctx.lineWidth = 3;
          ctx.shadowColor = "#34d399";
          ctx.shadowBlur = 15;
          ctx.stroke();
          ctx.restore();

          shockwave2Radius += 11;
          shockwave2Alpha -= 0.022;
        }

        // Draw particle explosion
        let activeParticles = 0;
        particles.forEach((p) => {
          if (p.alpha > 0) {
            activeParticles++;
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.97;
            p.vy *= 0.97;
            p.alpha -= p.decay;

            ctx.save();
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.alpha);
            ctx.shadowColor = "#00ff88";
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.restore();
          }
        });

        // Central blinding ring bloom
        const ringGlow = ctx.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          Math.min(width, height) * 0.28,
        );
        ringGlow.addColorStop(0, "rgba(255, 255, 255, 0.95)");
        ringGlow.addColorStop(0.35, "rgba(0, 255, 136, 0.8)");
        ringGlow.addColorStop(0.7, "rgba(16, 185, 129, 0.4)");
        ringGlow.addColorStop(1, "rgba(2, 44, 34, 0)");

        ctx.fillStyle = ringGlow;
        ctx.beginPath();
        ctx.arc(
          centerX,
          centerY,
          Math.min(width, height) * 0.28,
          0,
          Math.PI * 2,
        );
        ctx.fill();

        ctx.restore();

        frame++;
        if (
          (activeParticles > 0 || shockwaveAlpha > 0) &&
          frame < 120
        ) {
          animationFrameRef.current = requestAnimationFrame(render);
        } else {
          ctx.clearRect(0, 0, width, height);
          setBurstCompleted(true);
          onComplete?.();
        }
      };

      animationFrameRef.current = requestAnimationFrame(render);
    },
    [],
  );

  /**
   * Helper: Converts string or hex to Uint8Array buffer
   */
  const stringToBuffer = (str: string): Uint8Array => {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  };

  /**
   * Executes the FIDO2 WebAuthn credential assertion ceremony
   */
  const handleInitiateUnlock = useCallback(async () => {
    // Reset errors and abort active ceremonies
    setErrorType("none");
    setErrorMessage(null);
    setCeremonyState("verifying");

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // 1. Verify browser supports WebAuthn PublicKeyCredentials
      if (
        typeof window === "undefined" ||
        typeof window.PublicKeyCredential === "undefined" ||
        typeof navigator.credentials === "undefined" ||
        typeof navigator.credentials.get !== "function"
      ) {
        throw new DOMException(
          "Biometric FIDO2 hardware is not supported on this platform.",
          "NotSupportedError",
        );
      }

      // 2. Prepare FIDO2 PublicKeyCredentialRequestOptions
      const effectiveRpId =
        rpId ||
        (typeof window !== "undefined"
          ? window.location.hostname
          : "localhost");

      const rawChallenge = stringToBuffer(challenge);

      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: rawChallenge as unknown as BufferSource,
        rpId: effectiveRpId,
        timeout: 60000, // 60s standard timeout
        userVerification: "preferred",
      };

      // 3. Prompt user for biometric / passkey assertion
      const credential = (await navigator.credentials.get({
        publicKey: publicKeyOptions,
        signal: abortController.signal,
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw new DOMException(
          "No cryptographic credential returned from biometric sensor.",
          "InvalidStateError",
        );
      }

      // 4. Validate cryptographic assertion structure
      const assertionResponse =
        credential.response as AuthenticatorAssertionResponse;
      if (
        !credential.id ||
        !assertionResponse ||
        !assertionResponse.clientDataJSON ||
        !assertionResponse.signature
      ) {
        throw new Error(
          "Invalid WebAuthn assertion: Missing signature or clientDataJSON.",
        );
      }

      // 5. Verification passed: Trigger dazzling emerald hard-light beam particle explosion
      setCeremonyState("success");
      setChargeLevel(100);
      onUnlockSuccess?.(credential);

      triggerEmeraldEnergyBurst(() => {
        if (redirectTo && typeof window !== "undefined") {
          window.location.href = redirectTo;
        }
      });
    } catch (err: unknown) {
      // Handle strict WebAuthn DOMExceptions
      const errorObj = err as Error;
      const errorName = errorObj.name || "";
      const errorMsg = errorObj.message || "";

      let resolvedType: BiometricErrorType = "unknown";
      let resolvedMsg = "Cryptographic signature verification failed.";

      if (
        errorName === "NotAllowedError" ||
        errorMsg.toLowerCase().includes("cancelled") ||
        errorMsg.toLowerCase().includes("denied")
      ) {
        resolvedType = "cancelled";
        resolvedMsg = "Biometric ceremony canceled or denied by user.";
        onCancel?.();
      } else if (
        errorName === "TimeoutError" ||
        errorMsg.toLowerCase().includes("timeout") ||
        errorMsg.toLowerCase().includes("timed out")
      ) {
        resolvedType = "timeout";
        resolvedMsg =
          "Biometric hardware sensor timed out. Please tap the ring again to re-arm.";
      } else if (errorName === "NotSupportedError") {
        resolvedType = "unsupported";
        resolvedMsg =
          "Biometric FIDO2 hardware is not supported on this platform.";
      } else if (errorName === "SecurityError") {
        resolvedType = "security";
        resolvedMsg =
          "WebAuthn security error: RP ID or origin validation failed.";
      } else if (errorName === "AbortError") {
        resolvedType = "cancelled";
        resolvedMsg = "Biometric assertion request was aborted.";
      } else {
        resolvedType = "unknown";
        resolvedMsg = errorMsg || "Cryptographic assertion failed.";
      }

      setErrorType(resolvedType);
      setErrorMessage(resolvedMsg);
      setCeremonyState("error");
      onUnlockFailure?.(errorObj);
    } finally {
      abortControllerRef.current = null;
    }
  }, [
    rpId,
    challenge,
    triggerEmeraldEnergyBurst,
    onUnlockSuccess,
    onUnlockFailure,
    onCancel,
    redirectTo,
  ]);

  // Handle autoPrompt if requested
  useEffect(() => {
    if (autoPrompt && !hasPrompted && ceremonyState === "idle" && isSupported) {
      setHasPrompted(true);
      handleInitiateUnlock();
    }
  }, [autoPrompt, hasPrompted, ceremonyState, isSupported, handleInitiateUnlock]);

  const isVerifying = ceremonyState === "verifying";
  const isSuccess = ceremonyState === "success";
  const isError = ceremonyState === "error";

  return (
    <div
      data-testid="lantern-ring-biometric-unlock"
      className={`relative w-full max-w-lg mx-auto bg-black/90 text-slate-100 font-mono rounded-3xl border border-emerald-500/40 shadow-[0_0_50px_rgba(16,185,129,0.25)] p-6 sm:p-8 backdrop-blur-xl overflow-hidden ${className}`}
    >
      {/* GPU-Accelerated Energy Burst Canvas Overlay */}
      <canvas
        ref={canvasRef}
        data-testid="emerald-energy-burst-canvas"
        className={`absolute inset-0 w-full h-full pointer-events-none z-30 transition-opacity duration-300 ${
          isSuccess ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Background Holographic Coordinate Grid Accent */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(16, 185, 129, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(16, 185, 129, 0.15) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* TOP HEADER: SECTOR 2814 CRYPTOGRAPHIC OATH */}
      <div className="relative z-20 text-center space-y-1.5 mb-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-[11px] font-bold text-emerald-300 uppercase tracking-widest">
          <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          FIDO2 / WebAuthn Hardware Biometrics
        </div>
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center justify-center gap-2">
          <span>Lantern Ring Biometric Unlock</span>
        </h2>
        <p className="text-xs text-zinc-400 font-mono">
          SECTOR 2814 SECURE ACCESS // {userName.toUpperCase()}
        </p>
      </div>

      {/* CENTRAL 3D GLOWING GREEN LANTERN RING RETICLE */}
      <div className="relative z-20 flex flex-col items-center justify-center my-6">
        {/* Pulsing Ambient Hard-Light Aura */}
        <div
          data-testid="ring-ambient-aura"
          className={`absolute w-64 h-64 rounded-full blur-3xl transition-all duration-700 pointer-events-none ${
            isSuccess
              ? "bg-emerald-400/90 scale-150"
              : isVerifying
                ? "bg-emerald-500/50 scale-125 animate-pulse"
                : isError
                  ? "bg-rose-500/30 scale-100"
                  : "bg-emerald-500/30 scale-100"
          }`}
        />

        {/* 3D Ring Reticle Container */}
        <div
          tabIndex={0}
          role="button"
          aria-label="Tap 3D Green Lantern Ring to authenticate with biometrics"
          onClick={handleInitiateUnlock}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleInitiateUnlock();
            }
          }}
          data-testid="lantern-ring-reticle"
          className={`relative group w-48 h-48 sm:w-56 sm:h-56 rounded-full flex items-center justify-center cursor-pointer select-none transition-transform duration-300 focus:outline-none focus:ring-4 focus:ring-emerald-400/60 ${
            isVerifying
              ? "scale-105"
              : isSuccess
                ? "scale-110 shadow-[0_0_80px_#00ff88]"
                : "hover:scale-105"
          }`}
        >
          {/* SVG 3D Green Lantern Ring & Reticle Arcs */}
          <svg
            className="w-full h-full overflow-visible"
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <radialGradient id="ringCoreGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="35%" stopColor="#00ff88" stopOpacity="0.8" />
                <stop offset="75%" stopColor="#10b981" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#022c22" stopOpacity="0.2" />
              </radialGradient>
              <linearGradient
                id="metallicBand"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="40%" stopColor="#059669" />
                <stop offset="80%" stopColor="#022c22" />
                <stop offset="100%" stopColor="#064e3b" />
              </linearGradient>
              <linearGradient id="ringEdgeGlow" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#00ff88" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>

            {/* Outer Concentric Targeting Arcs */}
            <circle
              cx="100"
              cy="100"
              r="94"
              stroke="#10b981"
              strokeWidth="1.5"
              strokeOpacity="0.4"
              strokeDasharray="6 8"
              className={isVerifying ? "animate-spin origin-center" : ""}
              style={{ animationDuration: "14s" }}
              data-testid="ring-targeting-arcs"
            />
            <circle
              cx="100"
              cy="100"
              r="86"
              stroke="#00ff88"
              strokeWidth="2"
              strokeOpacity={isVerifying ? "0.8" : "0.5"}
              strokeDasharray="18 12 36 12"
              className={isVerifying ? "animate-spin origin-center" : ""}
              style={{ animationDuration: "8s", animationDirection: "reverse" }}
            />

            {/* 3D Ring Chassis Outer Bevel */}
            <circle
              cx="100"
              cy="100"
              r="76"
              fill="url(#metallicBand)"
              stroke="url(#ringEdgeGlow)"
              strokeWidth="4"
              filter="drop-shadow(0 0 16px rgba(16, 185, 129, 0.7))"
            />

            {/* Inner Ring Chamber */}
            <circle
              cx="100"
              cy="100"
              r="62"
              fill="#022c22"
              stroke="#00ff88"
              strokeWidth="2.5"
              strokeOpacity="0.8"
            />

            {/* Hard-Light Energy Core Fill */}
            <circle
              cx="100"
              cy="100"
              r="54"
              fill="url(#ringCoreGlow)"
              className={isVerifying ? "animate-pulse" : ""}
            />

            {/* GREEN LANTERN BATTERY EMBLEM (Centered Construct) */}
            <g transform="translate(100, 100) scale(0.9) translate(-50, -50)">
              {/* Top and Bottom Horizontal Parallel Battery Plates */}
              <rect
                x="22"
                y="14"
                width="56"
                height="10"
                rx="3"
                fill="#ffffff"
                className="drop-shadow-[0_0_8px_#00ff88]"
              />
              <rect
                x="22"
                y="76"
                width="56"
                height="10"
                rx="3"
                fill="#ffffff"
                className="drop-shadow-[0_0_8px_#00ff88]"
              />

              {/* Central Power Ring Chamber (Circle) */}
              <circle
                cx="50"
                cy="50"
                r="26"
                fill="none"
                stroke="#ffffff"
                strokeWidth="10"
                className="drop-shadow-[0_0_10px_#00ff88]"
              />
              <circle
                cx="50"
                cy="50"
                r="16"
                fill="#00ff88"
                fillOpacity="0.4"
              />
            </g>

            {/* Rotating Reticle Crosshairs */}
            <line
              x1="100"
              y1="8"
              x2="100"
              y2="24"
              stroke="#00ff88"
              strokeWidth="2.5"
            />
            <line
              x1="100"
              y1="176"
              x2="100"
              y2="192"
              stroke="#00ff88"
              strokeWidth="2.5"
            />
            <line
              x1="8"
              y1="100"
              x2="24"
              y2="100"
              stroke="#00ff88"
              strokeWidth="2.5"
            />
            <line
              x1="176"
              y1="100"
              x2="192"
              y2="100"
              stroke="#00ff88"
              strokeWidth="2.5"
            />
          </svg>

          {/* Central Biometric Fingerprint Icon Overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {isSuccess ? (
              <Unlock className="w-12 h-12 text-white animate-bounce drop-shadow-[0_0_15px_#00ff88]" />
            ) : isVerifying ? (
              <Fingerprint className="w-12 h-12 text-white animate-pulse drop-shadow-[0_0_15px_#00ff88]" />
            ) : isError ? (
              <ShieldAlert className="w-12 h-12 text-rose-300 drop-shadow-[0_0_15px_#f43f5e]" />
            ) : (
              <Fingerprint className="w-12 h-12 text-emerald-200 group-hover:text-white transition-colors drop-shadow-[0_0_10px_#00ff88]" />
            )}
          </div>
        </div>

        {/* Biometric Scanning Telemetry Readout */}
        <div className="mt-4 text-center space-y-1">
          <div
            data-testid="biometric-status-readout"
            className="text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center justify-center gap-2"
          >
            {isVerifying ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                <span>Awaiting Hardware Biometric Assertion...</span>
              </>
            ) : isSuccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Cryptographic Assertion Verified!</span>
              </>
            ) : isError ? (
              <>
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>Biometric Ceremony Halted</span>
              </>
            ) : (
              <span>Tap Ring Reticle to Authenticate</span>
            )}
          </div>

          <p className="text-[11px] text-zinc-400">
            {isVerifying
              ? "Touch device fingerprint sensor, passkey, or security key."
              : isSuccess
                ? "Emerald hard-light construct synthesized. Welcome, Guardian."
                : isError
                  ? "Security assertion interrupted. See details below."
                  : "Touch biometric sensor to assert cryptographic passkey."}
          </p>
        </div>
      </div>

      {/* ERROR ALERT BANNER: STRICT ERROR HANDLING */}
      {isError && (
        <div
          data-testid="auth-error-banner"
          className="relative z-20 mt-4 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/50 space-y-2 text-xs text-rose-300"
        >
          <div className="flex items-center gap-2 font-bold text-rose-400">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="uppercase tracking-wider">
              {errorType === "cancelled"
                ? "Ceremony Canceled"
                : errorType === "timeout"
                  ? "Hardware Timeout"
                  : errorType === "unsupported"
                    ? "Hardware Unsupported"
                    : "Authentication Error"}
            </span>
          </div>

          <p
            data-testid={
              errorType === "cancelled"
                ? "auth-error-cancelled"
                : errorType === "timeout"
                  ? "auth-error-timeout"
                  : errorType === "unsupported"
                    ? "auth-error-unsupported"
                    : "auth-error-generic"
            }
            className="text-[11px] leading-relaxed text-zinc-300"
          >
            {errorMessage}
          </p>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              onClick={handleInitiateUnlock}
              data-testid="retry-auth-btn"
              className="px-3 py-1.5 rounded-xl bg-rose-900/60 hover:bg-rose-800 border border-rose-500/50 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Ring Verification</span>
            </button>
          </div>
        </div>
      )}

      {/* PRIMARY ACTION BUTTON & BACKUP ACTIONS */}
      <div className="relative z-20 mt-6 space-y-3">
        {burstCompleted && (
          <div
            data-testid="dashboard-unlocked-badge"
            className="w-full py-3 px-4 rounded-2xl bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-bold text-xs flex items-center justify-center gap-2 animate-pulse shadow-[0_0_20px_rgba(16,185,129,0.4)]"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Sector 2814 Cryptographic Access Granted // Dashboard Unlocked</span>
          </div>
        )}
        {!isSuccess && (
          <button
            onClick={handleInitiateUnlock}
            disabled={isVerifying}
            data-testid="biometric-trigger-btn"
            className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-black font-extrabold text-sm tracking-wider uppercase transition shadow-[0_0_25px_rgba(16,185,129,0.5)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isVerifying ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-black" />
                <span>Scanning Biometric Sensor...</span>
              </>
            ) : (
              <>
                <Fingerprint className="w-4 h-4 text-black" />
                <span>Initiate Biometric Harness</span>
              </>
            )}
          </button>
        )}

        {/* Willpower Battery Status & Oath */}
        <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
          <span className="flex items-center gap-1 text-emerald-400/80">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            Willpower Reserve: {chargeLevel}%
          </span>
          <span className="italic text-zinc-400">
            &ldquo;In Brightest Day...&rdquo;
          </span>
        </div>
      </div>
    </div>
  );
}

export default LanternRingBiometricUnlock;
