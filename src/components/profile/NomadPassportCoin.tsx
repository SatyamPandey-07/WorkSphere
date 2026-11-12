"use client";
import React from 'react';
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
}

function createCoinTexture(stamp: PassportStamp, reverse: boolean) {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const center = 512;
  const radius = 492;
  const background = context.createRadialGradient(
    center,
    420,
    60,
    center,
    center,
    510,
  );
  background.addColorStop(0, reverse ? "#263a45" : "#30424a");
  background.addColorStop(0.68, reverse ? "#132832" : "#182d36");
  background.addColorStop(1, "#0c1b22");
  context.fillStyle = background;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(239, 197, 124, 0.9)";
  context.lineWidth = 12;
  context.beginPath();
  context.arc(center, center, 458, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = "rgba(239, 197, 124, 0.45)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(center, center, 432, 0, Math.PI * 2);
  context.stroke();

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f4d59c";

  if (reverse) {
    const attestation =
      stamp.nullifierHash || stamp.verificationSignature || stamp.stampId;
    context.font = "600 34px monospace";
    context.fillText("WORKSPHERE ATTESTATION", center, 290);
    context.font = "700 54px Georgia, serif";
    context.fillText("ZK VERIFIED", center, 450);
    context.font = "500 30px monospace";
    context.fillStyle = "#d6e0dc";
    for (let index = 0; index < 4; index++) {
      context.fillText(
        attestation.slice(index * 16, index * 16 + 16),
        center,
        540 + index * 48,
      );
    }
    context.font = "600 28px monospace";
    context.fillStyle = "#e9bd79";
    context.fillText(`EPOCH ${stamp.epoch}`, center, 790);
  } else {
    const initials = (stamp.venueName || "WorkSphere")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
    context.font = "500 32px monospace";
    context.fillText("NOMAD PASSPORT", center, 270);

    context.strokeStyle = "#f4d59c";
    context.lineWidth = 10;
    context.beginPath();
    context.arc(center, center + 8, 142, 0, Math.PI * 2);
    context.stroke();
    context.font = "700 136px Georgia, serif";
    context.fillText(initials || "W", center, center + 15);

    context.font = "600 37px Georgia, serif";
    context.fillText(
      (stamp.venueName || "WORKSPHERE HUB").toUpperCase().slice(0, 25),
      center,
      700,
    );
    context.font = "500 28px monospace";
    context.fillText(
      stamp.countryCode
        ? `${stamp.countryCode} - VERIFIED VENUE`
        : "VERIFIED VENUE",
      center,
      765,
    );
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

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
      <div
        className={`${styles.rotor} ${styles.transformStyle3d} ${flipped ? styles.rotateY180 : ""}`}
      >
        <div className={styles.face}>
          <span className={styles.kicker}>NOMAD PASSPORT</span>
          <strong className={styles.initials}>{initials || "W"}</strong>
          <span className={styles.venue}>
            {stamp.venueName || "WorkSphere Hub"}
          </span>
          <span className={styles.kicker}>VERIFIED VENUE</span>
        </div>
        <div className={`${styles.face} ${styles.faceBack}`}>
          <span className={styles.kicker}>WORKSPHERE ATTESTATION</span>
          <strong className={styles.verified}>ZK VERIFIED</strong>
          <span className={styles.hash}>{attestation}</span>
          <span className={styles.kicker}>EPOCH {stamp.epoch}</span>
        </div>
      </div>
    </div>
  );
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
export type NomadTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

interface NomadPassportCoinProps {
  tier: NomadTier;
  xpEarned: number;
  className?: string;
}

const TIER_COLORS: Record<NomadTier, { ring: string; bg: string; text: string }> = {
  Bronze: { ring: 'border-amber-700/80', bg: 'from-amber-950 to-amber-900', text: 'text-amber-600' },
  Silver: { ring: 'border-slate-400/80', bg: 'from-slate-900 to-slate-800', text: 'text-slate-300' },
  Gold: { ring: 'border-yellow-500/80', bg: 'from-yellow-950 to-yellow-900', text: 'text-yellow-400' },
  Platinum: { ring: 'border-cyan-400/80', bg: 'from-cyan-950 to-slate-900', text: 'text-cyan-400' },
};

export const NomadPassportCoin: React.FC<NomadPassportCoinProps> = ({
  tier,
  xpEarned,
  className = '',
}) => {
  const colors = TIER_COLORS[tier] || TIER_COLORS.Bronze;
  const titleId = `coin-tier-title-${tier.toLowerCase()}`;
  const descId = `coin-tier-desc-${tier.toLowerCase()}`;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={0}
      className={`relative w-32 h-32 rounded-full border-4 ${colors.ring} bg-gradient-to-br ${colors.bg} p-2 shadow-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${className}`}
    >
      {/* Hidden description for screen readers */}
      <span id={descId} className="sr-only">
        {tier} Nomad Passport coin. You have earned {xpEarned.toLocaleString()} experience points in this tier.
      </span>

      <svg
        className="w-12 h-12 mb-1 drop-shadow-md"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{tier} Nomad Passport Coin</title>
        <circle cx="12" cy="12" r="10" />
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>

      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
        {tier}
      </span>
      <span className="text-[10px] font-mono text-slate-400 mt-0.5">
        {xpEarned.toLocaleString()} XP
      </span>
    </div>
  );
};

export default NomadPassportCoin;
