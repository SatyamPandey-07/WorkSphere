 feat/nomad-passport-haptics
import React, { useState } from 'react';

interface NomadPassportCoinProps {
  passportId: string;
  nomadName: string;
  countryCode: string;
  stampsCount: number;
  isVerified?: boolean;

"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { CanvasTexture, DoubleSide, Group, SRGBColorSpace } from "three";
import type { PassportStamp } from "@/lib/zkp/nomadProof";
import styles from "./NomadPassportCoin.module.css";

export interface NomadPassportCoinProps {
  stamp?: PassportStamp;
  isLoading?: boolean;
  isLoaded?: boolean;
  className?: string;
  onReady?: () => void;
}

const DEFAULT_STAMP: PassportStamp = {
  stampId: "stamp-default-001",
  badgeType: "bronze",
  tierTitle: "Nomad Explorer",
  issuedAt: "2026-01-01T00:00:00.000Z",
  svgMarkup: "<svg></svg>",
  venueName: "WorkSphere Hub",
  epoch: 1,
  nullifierHash: "0x00000000000000000000000000000000",
  verificationSignature: "zk-sig-verified-epoch-1",
  countryCode: "US",
};

/**
 * Animated CSS shimmer pulse skeleton component rendered during 3D WebGL asset
 * and texture compilation. Maintains identical coin diameter (max-w-[20rem]) and 1:1
 * aspect ratio to eliminate Cumulative Layout Shift (CLS = 0).
 */
export function NomadPassportCoinSkeleton({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Loading nomad passport coin"
      data-testid="nomad-coin-skeleton"
      className={`relative rounded-full aspect-square w-full max-w-[20rem] mx-auto overflow-hidden border-4 border-muted/40 shadow-inner flex items-center justify-center bg-gradient-to-r from-muted via-muted/50 to-muted animate-pulse ${className}`}
    >
      {/* Concentric inner relief rings matching 3D coin edge geometry */}
      <div className="absolute inset-3 rounded-full border border-muted/30 pointer-events-none" />
      <div className="absolute inset-8 rounded-full border border-muted/20 pointer-events-none" />
      <div className="w-16 h-16 rounded-full bg-muted/40 animate-pulse flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-muted/30" />
      </div>
      <span className="sr-only">Loading nomad passport coin...</span>
    </div>
  );
 main
}

export const NomadPassportCoin: React.FC<NomadPassportCoinProps> = ({
  passportId,
  nomadName,
  countryCode,
  stampsCount,
  isVerified = true,
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [stampRevealed, setStampRevealed] = useState(false);

  const triggerHaptic = (pattern: number | number[]) => {
    if (typeof window !== 'undefined' && 'navigator' in window && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  };

  const handleCardClick = () => {
    triggerHaptic(15);
    setIsFlipped((prev) => !prev);
  };

 feat/nomad-passport-haptics
  const handleStampClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic([10, 30, 10]);
    setStampRevealed((prev) => !prev);
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">

function CoinMesh({
  stamp,
  flipped,
}: {
  stamp: PassportStamp;
  flipped: boolean;
}) {
  const coin = useRef<Group>(null);
  const frontTexture = useMemo(() => createCoinTexture(stamp, false), [stamp]);
  const backTexture = useMemo(() => createCoinTexture(stamp, true), [stamp]);

  useEffect(
    () => () => {
      frontTexture?.dispose();
      backTexture?.dispose();
    },
    [frontTexture, backTexture],
  );

  useFrame(({ clock }, delta) => {
    if (!coin.current) return;
    const idleTurn = Math.sin(clock.elapsedTime * 0.42) * 0.08;
    const target = (flipped ? Math.PI : 0) + idleTurn;
    coin.current.rotation.y +=
      (target - coin.current.rotation.y) * (1 - Math.exp(-delta * 5));
    coin.current.rotation.x +=
      (0.08 - coin.current.rotation.x) * (1 - Math.exp(-delta * 4));
  });

  return (
    <group ref={coin}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.23, 1.23, 0.15, 96, 1, false]} />
        <meshStandardMaterial
          color="#c9934f"
          metalness={0.94}
          roughness={0.24}
        />
      </mesh>
      <mesh position={[0, 0, 0.078]}>
        <circleGeometry args={[1.19, 96]} />
        <meshStandardMaterial
          map={frontTexture ?? undefined}
          color="#dcb675"
          metalness={0.62}
          roughness={0.32}
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, -0.078]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[1.19, 96]} />
        <meshStandardMaterial
          map={backTexture ?? undefined}
          color="#dcb675"
          metalness={0.62}
          roughness={0.32}
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, 0.02]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[1.205, 0.025, 12, 96]} />
        <meshStandardMaterial
          color="#f0ca86"
          metalness={0.98}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

function CoinFallback({
  stamp,
  flipped,
}: {
  stamp: PassportStamp;
  flipped: boolean;
}) {
  const attestation =
    stamp.nullifierHash || stamp.verificationSignature || stamp.stampId;
  const initials = (stamp.venueName || "WorkSphere")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  return (
    <div className={styles.fallback} aria-hidden="true">
 main
      <div
        onClick={handleCardClick}
        className={
elative w-72 h-44 rounded-2xl cursor-pointer transition-transform duration-500 transform-gpu shadow-xl }
        style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
      >
        <div
          className={bsolute inset-0 w-full h-full rounded-2xl p-5 flex flex-col justify-between bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white shadow-lg backface-hidden }
        >
          <div className="flex justify-between items-center">
            <span className="text-xs uppercase tracking-widest font-semibold opacity-80">Digital Nomad Passport</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-xs font-mono">{countryCode}</span>
          </div>
          <div>
            <h3 className="text-lg font-bold truncate">{nomadName}</h3>
            <p className="text-xs font-mono opacity-90">{passportId}</p>
          </div>
          <div className="flex justify-between items-end">
            <span className="text-xs bg-black/20 px-2.5 py-1 rounded-full">{stampsCount} stamps verified</span>
            <span className={	ext-xs px-2 py-0.5 rounded }>
              {isVerified ? 'Active' : 'Pending'}
            </span>
          </div>
        </div>

        <div
          onClick={handleStampClick}
          className={bsolute inset-0 w-full h-full rounded-2xl p-5 flex flex-col justify-between bg-slate-900 border border-purple-500/40 text-white shadow-lg rotate-y-180 backface-hidden }
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-indigo-400">SECURE HASH VERIFICATION</span>
            <span className="text-xs text-slate-400">Tap stamp</span>
          </div>
          <div className="flex flex-col items-center justify-center my-auto">
            <div
              className={px-4 py-2 rounded-lg border text-sm font-bold transition-colors duration-300 }
            >
              {stampRevealed ? '? Stamp Authenticated' : 'Click to Verify Stamp'}
            </div>
          </div>
          <div className="text-center text-[10px] text-slate-500 font-mono">WorkSphere Decentralized Protocol</div>
        </div>
      </div>
    </div>
  );
 feat/nomad-passport-haptics
};

}

interface CoinErrorBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

interface CoinErrorBoundaryState {
  failed: boolean;
}

class CoinErrorBoundary extends React.Component<
  CoinErrorBoundaryProps,
  CoinErrorBoundaryState
> {
  state: CoinErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): CoinErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.warn("3D passport coin failed; using the 2D coin preview.", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function NomadPassportCoin({
  stamp = DEFAULT_STAMP,
  isLoading,
  isLoaded,
  className = "",
  onReady,
}: NomadPassportCoinProps) {
  const [webglSupported, setWebglSupported] = useState(false);
  const [internalLoaded, setInternalLoaded] = useState(false);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const probe = document.createElement("canvas");
    let supported = false;
    try {
      if (
        !window.WebGLRenderingContext &&
        !("WebGL2RenderingContext" in window)
      ) {
        setWebglSupported(false);
        setInternalLoaded(true);
        onReady?.();
        return;
      }
      supported = Boolean(
        probe.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
        probe.getContext("webgl", { failIfMajorPerformanceCaveat: true }),
      );
      const context = probe.getContext("webgl2") || probe.getContext("webgl");
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      supported = false;
    }
    setWebglSupported(supported);
    if (!supported) {
      setInternalLoaded(true);
      onReady?.();
    }
  }, [onReady]);

  // Determine whether to display the shimmer pulse skeleton
  const isCoinLoading =
    isLoading !== undefined
      ? isLoading
      : isLoaded !== undefined
        ? !isLoaded
        : !internalLoaded;

  const handleCanvasCreated = () => {
    setInternalLoaded(true);
    onReady?.();
  };

  const fallback = <CoinFallback stamp={stamp} flipped={flipped} />;

  return (
    <div
      className={`relative w-full max-w-[20rem] aspect-square mx-auto ${className}`}
      data-testid="nomad-coin-container"
    >
      {/* Animated CSS shimmer pulse skeleton component */}
      {isCoinLoading && (
        <NomadPassportCoinSkeleton className="absolute inset-0 z-10" />
      )}

      {/* Interactive 3D Canvas / Fallback coin element */}
      <button
        type="button"
        aria-label={`${stamp.venueName || "Nomad passport"} coin. Hover or activate to reveal its attestation hash.`}
        aria-pressed={flipped}
        className={`${styles.button} ${styles.perspective1000} ${
          isCoinLoading
            ? "opacity-0 pointer-events-none"
            : "opacity-100 transition-opacity duration-300"
        }`}
        onMouseEnter={() => setFlipped(true)}
        onMouseLeave={() => setFlipped(false)}
        onFocus={() => setFlipped(true)}
        onBlur={() => setFlipped(false)}
        onClick={() => setFlipped(true)}
      >
        {webglSupported ? (
          <CoinErrorBoundary fallback={fallback}>
            <Canvas
              dpr={[1, 1.5]}
              camera={{ position: [0, 0, 4.25], fov: 36 }}
              shadows
              fallback={fallback}
              onCreated={handleCanvasCreated}
            >
              <ambientLight intensity={1.5} />
              <directionalLight position={[3, 4, 5]} intensity={4} castShadow />
              <pointLight
                position={[-3, -2, 3]}
                intensity={1.3}
                color="#7ec9df"
              />
              <CoinMesh stamp={stamp} flipped={flipped} />
            </Canvas>
          </CoinErrorBoundary>
        ) : (
          fallback
        )}
        <span className="sr-only">
          {flipped ? "Attestation hash face" : "Venue logo face"}
        </span>
      </button>
    </div>
  );
}

export default NomadPassportCoin;
 main
