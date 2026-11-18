"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Sparkles, RefreshCw, AlertTriangle, X } from "lucide-react";

// ─── TYPES & INTERFACES ────────────────────────────────────────────────────────

export type BatteryChargeState =
  | "depleted"
  | "charging"
  | "active"
  | "full"
  | "overcharged"
  | "initiating"
  | "waiting"
  | "success"
  | "failed";

export interface CentralPowerBatteryModelProps {
  /** Battery charge percentage (0 to 100) */
  chargePercentage?: number;
  /** High-level operational / ceremony charge state */
  chargeState?: BatteryChargeState;
  /** Whether interactive pointer drag is enabled (default true) */
  interactive?: boolean;
  /** Whether device gyroscope tilt is enabled on supported mobile devices (default true) */
  enableDeviceTilt?: boolean;
  /** Custom class name for the wrapper container */
  className?: string;
  /** Width & height or style */
  style?: React.CSSProperties;
  /** Force 2D fallback rendering (useful for low-power mode or testing) */
  forceFallback?: boolean;
  /** Callback fired when WebGL context is lost */
  onContextLost?: () => void;
  /** Callback fired when WebGL context is restored */
  onContextRestored?: () => void;
  /** Optional custom test ID */
  testId?: string;
}

// ─── POLYGON BUDGET CALCULATOR (< 10,000 Polygons) ────────────────────────────

/**
 * Returns the exact total polygon (triangle) count across all geometries
 * used in the Central Power Battery mesh. Must stay strictly under 10,000.
 */
export function getBatteryPolygonCount(): {
  totalTriangles: number;
  isOptimizedUnder10k: boolean;
  breakdown: Record<string, number>;
} {
  const geometries = {
    basePlinth: new THREE.CylinderGeometry(1.6, 1.8, 0.35, 24),
    baseRing: new THREE.TorusGeometry(1.55, 0.08, 12, 24),
    lowerBowl: new THREE.CylinderGeometry(1.35, 0.95, 1.0, 24, 2),
    waistRing: new THREE.TorusGeometry(1.35, 0.07, 12, 24),
    verticalStruts: new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8),
    coreSphere: new THREE.SphereGeometry(0.75, 24, 20),
    innerCoreSphere: new THREE.SphereGeometry(0.35, 16, 16),
    frontApertureRing: new THREE.TorusGeometry(0.95, 0.09, 12, 28),
    horizontalFlange: new THREE.BoxGeometry(1.8, 0.16, 0.22),
    upperCowl: new THREE.CylinderGeometry(0.9, 1.35, 0.9, 24, 2),
    topCollarRing: new THREE.TorusGeometry(0.92, 0.07, 12, 24),
    topCapFinial: new THREE.CylinderGeometry(0.4, 0.75, 0.35, 20),
    handleArch: new THREE.TorusGeometry(1.2, 0.09, 12, 28, Math.PI),
    energyRingInner: new THREE.TorusGeometry(1.65, 0.035, 8, 32),
    energyRingOuter: new THREE.TorusGeometry(1.85, 0.03, 8, 32),
    godRayQuad: new THREE.PlaneGeometry(3.5, 3.5, 4, 4),
  };

  const getTris = (g: THREE.BufferGeometry) =>
    g.index ? g.index.count / 3 : g.attributes.position.count / 3;

  const breakdown: Record<string, number> = {
    basePlinth: getTris(geometries.basePlinth),
    baseRing: getTris(geometries.baseRing),
    lowerBowl: getTris(geometries.lowerBowl),
    waistRing: getTris(geometries.waistRing),
    verticalStruts: getTris(geometries.verticalStruts) * 4,
    coreSphere: getTris(geometries.coreSphere),
    innerCoreSphere: getTris(geometries.innerCoreSphere),
    frontApertureRing: getTris(geometries.frontApertureRing),
    horizontalFlanges: getTris(geometries.horizontalFlange) * 2,
    upperCowl: getTris(geometries.upperCowl),
    topCollarRing: getTris(geometries.topCollarRing),
    topCapFinial: getTris(geometries.topCapFinial),
    handleArch: getTris(geometries.handleArch),
    energyRings:
      getTris(geometries.energyRingInner) + getTris(geometries.energyRingOuter),
    godRayQuad: getTris(geometries.godRayQuad),
  };

  const totalTriangles = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // Dispose test geometries
  Object.values(geometries).forEach((g) => g.dispose());

  return {
    totalTriangles,
    isOptimizedUnder10k: totalTriangles < 10000,
    breakdown,
  };
}

// ─── SHADERS: VOLUMETRIC GOD-RAYS ──────────────────────────────────────────────

const GodRayVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPosition;

  void main() {
    vUv = uv;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GodRayFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uCharge;
  uniform vec2 uPointer;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vPosition;

  void main() {
    vec2 centered = vUv - vec2(0.5);
    float dist = length(centered);
    float angle = atan(centered.y, centered.x);

    // Dynamic pulsating radial willpower rays
    float rays1 = sin(angle * 12.0 + uTime * 1.6) * 0.5 + 0.5;
    float rays2 = sin(angle * 24.0 - uTime * 2.4) * 0.5 + 0.5;
    float combinedRays = mix(rays1, rays2, 0.42);

    // Radial beam attenuation & soft emerald core
    float falloff = smoothstep(0.5, 0.04, dist);
    float coreGlow = smoothstep(0.18, 0.0, dist) * 1.8;

    // Reacting to pointer position & drag deflection
    float pointerInteraction = 1.0 + dot(normalize(centered + 0.0001), uPointer) * 0.4;

    // Modulated by charge state
    float chargeFactor = clamp(uCharge, 0.15, 1.4);
    float alpha = (combinedRays * falloff * 0.65 + coreGlow) * chargeFactor * pointerInteraction;
    alpha = clamp(alpha, 0.0, 0.92);

    gl_FragColor = vec4(uColor * (1.1 + coreGlow * 0.6), alpha);
  }
`;

// ─── 3D BATTERY MESH COMPONENT ────────────────────────────────────────────────

interface BatteryMeshProps {
  chargeRatio: number;
  chargeState: BatteryChargeState;
  interactive: boolean;
  enableDeviceTilt: boolean;
  targetPointer: React.MutableRefObject<{ x: number; y: number }>;
  isDraggingRef: React.MutableRefObject<boolean>;
  dragDeltaRef: React.MutableRefObject<{ x: number; y: number }>;
}

export function BatteryMesh({
  chargeRatio,
  chargeState,
  targetPointer,
  isDraggingRef,
  dragDeltaRef,
}: BatteryMeshProps) {
  const rootGroupRef = useRef<THREE.Group>(null);
  const coreMeshRef = useRef<THREE.Mesh>(null);
  const innerCoreMeshRef = useRef<THREE.Mesh>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const godRayMeshRef = useRef<THREE.Mesh>(null);
  const pointLightRef = useRef<THREE.PointLight>(null);

  const currentRotation = useRef({ x: 0, y: 0 });
  const pointerSmooth = useRef(new THREE.Vector2(0, 0));

  // Volumetric God-Ray Shader Material
  const godRayMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: GodRayVertexShader,
      fragmentShader: GodRayFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uCharge: { value: chargeRatio },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uColor: {
          value: new THREE.Color(
            chargeState === "failed" ? "#ef4444" : "#34d399",
          ),
        },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [chargeRatio, chargeState]);

  // Metallic Alien Emerald Materials
  const metallicGreenMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(chargeState === "failed" ? "#450a0a" : "#043927"),
      metalness: 0.88,
      roughness: 0.22,
      emissive: new THREE.Color(
        chargeState === "failed" ? "#7f1d1d" : "#064e3b",
      ),
      emissiveIntensity: 0.25 * chargeRatio,
    });
  }, [chargeRatio, chargeState]);

  const metallicAccentMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(chargeState === "failed" ? "#dc2626" : "#059669"),
      metalness: 0.92,
      roughness: 0.18,
      emissive: new THREE.Color(
        chargeState === "failed" ? "#991b1b" : "#10b981",
      ),
      emissiveIntensity: 0.45 * chargeRatio,
    });
  }, [chargeRatio, chargeState]);

  const coreMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(chargeState === "failed" ? "#f87171" : "#34d399"),
      emissive: new THREE.Color(
        chargeState === "failed" ? "#ef4444" : "#10b981",
      ),
      emissiveIntensity: 1.8 * chargeRatio,
      roughness: 0.12,
      metalness: 0.08,
      transparent: true,
      opacity: 0.88,
    });
  }, [chargeRatio, chargeState]);

  const innerCoreMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(chargeState === "failed" ? "#fecaca" : "#a7f3d0"),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
  }, [chargeState]);

  const energyRingMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(chargeState === "failed" ? "#f87171" : "#6ee7b7"),
      transparent: true,
      opacity: 0.72 * Math.min(chargeRatio + 0.2, 1.0),
      blending: THREE.AdditiveBlending,
    });
  }, [chargeRatio, chargeState]);

  // Frame animation & physics loop
  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime();

    // Update custom shader uniforms via mesh material ref
    const godRayMat = godRayMeshRef.current?.material as THREE.ShaderMaterial | undefined;
    if (godRayMat?.uniforms) {
      godRayMat.uniforms.uTime.value = elapsed;
      godRayMat.uniforms.uCharge.value = chargeRatio;
      pointerSmooth.current.lerp(
        new THREE.Vector2(targetPointer.current.x, targetPointer.current.y),
        delta * 6,
      );
      godRayMat.uniforms.uPointer.value.copy(pointerSmooth.current);
    }

    // Apply drag deltas to target rotation
    if (isDraggingRef.current) {
      currentRotation.current.y += dragDeltaRef.current.x * 0.012;
      currentRotation.current.x += dragDeltaRef.current.y * 0.012;
      dragDeltaRef.current.x = 0;
      dragDeltaRef.current.y = 0;
    }

    // Gentle idle floating & tilt interpolation
    if (rootGroupRef.current) {
      const idleFloatY = Math.sin(elapsed * 1.4) * 0.08;
      const idleSwayX = Math.cos(elapsed * 0.8) * 0.03;
      const targetX = currentRotation.current.x + idleSwayX;
      const targetY = currentRotation.current.y;

      rootGroupRef.current.position.y = idleFloatY;
      rootGroupRef.current.rotation.y = THREE.MathUtils.damp(
        rootGroupRef.current.rotation.y,
        targetY,
        8,
        delta,
      );
      rootGroupRef.current.rotation.x = THREE.MathUtils.damp(
        rootGroupRef.current.rotation.x,
        targetX,
        8,
        delta,
      );
    }

    // Emerald Core Pulsation
    if (coreMeshRef.current) {
      const pulseSpeed = chargeState === "failed" ? 1.0 : 2.4;
      const pulseScale = 1.0 + Math.sin(elapsed * pulseSpeed) * 0.05 * chargeRatio;
      coreMeshRef.current.scale.set(pulseScale, pulseScale, pulseScale);
    }

    if (innerCoreMeshRef.current) {
      const innerPulse = 1.0 + Math.cos(elapsed * 3.2) * 0.08 * chargeRatio;
      innerCoreMeshRef.current.scale.set(innerPulse, innerPulse, innerPulse);
    }

    // Pulsating Counter-Rotating Energy Rings
    if (ring1Ref.current) {
      ring1Ref.current.rotation.z += delta * 1.5;
      ring1Ref.current.rotation.y += delta * 0.8;
      const rScale = 1.0 + Math.sin(elapsed * 2.0) * 0.04;
      ring1Ref.current.scale.set(rScale, rScale, rScale);
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.z -= delta * 1.2;
      ring2Ref.current.rotation.x += delta * 0.6;
      const rScale2 = 1.0 + Math.cos(elapsed * 2.4) * 0.05;
      ring2Ref.current.scale.set(rScale2, rScale2, rScale2);
    }

    // Point Light Intensity Pulse
    if (pointLightRef.current) {
      const lightPulse =
        (5.0 + Math.sin(elapsed * 3.0) * 2.0) * Math.max(chargeRatio, 0.2);
      pointLightRef.current.intensity = lightPulse;
    }

    // Keep god-ray mesh facing camera
    if (godRayMeshRef.current && rootGroupRef.current) {
      godRayMeshRef.current.quaternion.copy(
        rootGroupRef.current.quaternion.clone().invert(),
      );
    }
  });

  return (
    <group ref={rootGroupRef} position={[0, 0, 0]}>
      {/* ── CENTRAL GLOWING EMERALD CORE ── */}
      <mesh ref={coreMeshRef} position={[0, 0, 0]}>
        <sphereGeometry args={[0.75, 24, 20]} />
        <primitive object={coreMaterial} attach="material" />
      </mesh>

      {/* Dense white-hot inner core */}
      <mesh ref={innerCoreMeshRef} position={[0, 0, 0]}>
        <sphereGeometry args={[0.35, 16, 16]} />
        <primitive object={innerCoreMaterial} attach="material" />
      </mesh>

      {/* Volumetric Emerald Point Light */}
      <pointLight
        ref={pointLightRef}
        color={chargeState === "failed" ? "#ef4444" : "#10b981"}
        distance={10}
        decay={2}
      />

      {/* ── VOLUMETRIC GOD-RAYS SHADER PLANE ── */}
      <mesh ref={godRayMeshRef} position={[0, 0, 0.05]}>
        <planeGeometry args={[3.5, 3.5, 4, 4]} />
        <primitive object={godRayMaterial} attach="material" />
      </mesh>

      {/* ── PULSATING ENERGY RINGS ── */}
      <mesh
        ref={ring1Ref}
        rotation={[Math.PI / 4, 0, 0]}
        position={[0, 0, 0]}
      >
        <torusGeometry args={[1.65, 0.035, 8, 32]} />
        <primitive object={energyRingMaterial} attach="material" />
      </mesh>
      <mesh
        ref={ring2Ref}
        rotation={[-Math.PI / 4, Math.PI / 3, 0]}
        position={[0, 0, 0]}
      >
        <torusGeometry args={[1.85, 0.03, 8, 32]} />
        <primitive object={energyRingMaterial} attach="material" />
      </mesh>

      {/* ── BASE PEDESTAL & STEPS ── */}
      <mesh position={[0, -1.8, 0]}>
        <cylinderGeometry args={[1.6, 1.8, 0.35, 24]} />
        <primitive object={metallicGreenMaterial} attach="material" />
      </mesh>
      <mesh position={[0, -1.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.55, 0.08, 12, 24]} />
        <primitive object={metallicAccentMaterial} attach="material" />
      </mesh>

      {/* ── LOWER RESERVOIR BOWL / URN ── */}
      <mesh position={[0, -1.05, 0]}>
        <cylinderGeometry args={[1.35, 0.95, 1.0, 24, 2]} />
        <primitive object={metallicGreenMaterial} attach="material" />
      </mesh>
      <mesh position={[0, -0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.35, 0.07, 12, 24]} />
        <primitive object={metallicAccentMaterial} attach="material" />
      </mesh>

      {/* ── 4 VERTICAL SUPPORT STRUTS ── */}
      {[-0.95, 0.95].map((x) =>
        [-0.95, 0.95].map((z) => (
          <mesh key={`${x}-${z}`} position={[x * 0.9, 0, z * 0.9]}>
            <cylinderGeometry args={[0.08, 0.08, 1.4, 8]} />
            <primitive object={metallicAccentMaterial} attach="material" />
          </mesh>
        )),
      )}

      {/* ── ICONIC GREEN LANTERN FRONT APERTURE & FLANGES ── */}
      <mesh position={[0, 0, 0.72]}>
        <torusGeometry args={[0.95, 0.09, 12, 28]} />
        <primitive object={metallicAccentMaterial} attach="material" />
      </mesh>
      {/* Top horizontal flange */}
      <mesh position={[0, 0.8, 0.72]}>
        <boxGeometry args={[1.8, 0.16, 0.22]} />
        <primitive object={metallicAccentMaterial} attach="material" />
      </mesh>
      {/* Bottom horizontal flange */}
      <mesh position={[0, -0.8, 0.72]}>
        <boxGeometry args={[1.8, 0.16, 0.22]} />
        <primitive object={metallicAccentMaterial} attach="material" />
      </mesh>

      {/* ── UPPER DOME & COWL ── */}
      <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.35, 0.07, 12, 24]} />
        <primitive object={metallicAccentMaterial} attach="material" />
      </mesh>
      <mesh position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.9, 1.35, 0.9, 24, 2]} />
        <primitive object={metallicGreenMaterial} attach="material" />
      </mesh>
      <mesh position={[0, 1.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.92, 0.07, 12, 24]} />
        <primitive object={metallicAccentMaterial} attach="material" />
      </mesh>
      <mesh position={[0, 1.7, 0]}>
        <cylinderGeometry args={[0.4, 0.75, 0.35, 20]} />
        <primitive object={metallicGreenMaterial} attach="material" />
      </mesh>

      {/* ── OVERHEAD ARCHED LANTERN HANDLE ── */}
      <mesh position={[0, 1.85, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[1.2, 0.09, 12, 28, Math.PI]} />
        <primitive object={metallicAccentMaterial} attach="material" />
      </mesh>
    </group>
  );
}

// ─── ERROR BOUNDARY ────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class CentralPowerBatteryErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn("CentralPowerBattery 3D WebGL failed; rendering 2D SVG fallback.", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ─── GRACEFUL 2D SVG FALLBACK ──────────────────────────────────────────────────

export interface CentralPowerBatterySvgFallbackProps {
  chargePercentage?: number;
  chargeState?: BatteryChargeState;
  onRetryWebGL?: () => void;
  className?: string;
  isContextLost?: boolean;
}

export function CentralPowerBatterySvgFallback({
  chargePercentage = 100,
  chargeState = "full",
  onRetryWebGL,
  className = "",
  isContextLost = false,
}: CentralPowerBatterySvgFallbackProps) {
  const isFailed = chargeState === "failed" || chargeState === "depleted";
  const isCharging = chargeState === "charging" || chargeState === "waiting" || chargeState === "initiating";

  return (
    <div
      data-testid="central-power-battery-svg-fallback"
      role="img"
      aria-label="Green Lantern Central Power Battery (2D Fallback)"
      className={`relative flex flex-col items-center justify-center select-none p-4 rounded-3xl bg-zinc-950/90 border border-emerald-500/30 overflow-hidden ${className}`}
    >
      {/* Background radial glow */}
      <div
        className={`absolute inset-0 rounded-full blur-3xl pointer-events-none transition-all duration-700 ${
          isFailed
            ? "bg-rose-600/25"
            : isCharging
              ? "bg-emerald-500/40 animate-pulse"
              : "bg-emerald-400/50"
        }`}
      />

      {/* SVG Battery Model */}
      <svg
        viewBox="0 0 200 240"
        className="w-48 h-56 sm:w-56 sm:h-64 relative z-10 transition-transform duration-500 hover:scale-105"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        data-testid="central-power-battery-fallback-svg"
      >
        <defs>
          <linearGradient id="fallback-emerald" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isFailed ? "#f87171" : "#34d399"} />
            <stop offset="50%" stopColor={isFailed ? "#ef4444" : "#059669"} />
            <stop offset="100%" stopColor={isFailed ? "#7f1d1d" : "#022c22"} />
          </linearGradient>

          <radialGradient id="fallback-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={isFailed ? "#fee2e2" : "#a7f3d0"} />
            <stop offset="45%" stopColor={isFailed ? "#ef4444" : "#10b981"} />
            <stop offset="100%" stopColor={isFailed ? "#991b1b" : "#064e3b"} />
          </radialGradient>

          <filter id="fallback-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Arched Carrying Handle */}
        <path
          d="M 50 80 A 50 50 0 0 1 150 80"
          stroke="url(#fallback-emerald)"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />

        {/* Top Cap Finial */}
        <ellipse cx="100" cy="72" rx="20" ry="8" fill="url(#fallback-emerald)" />
        <path d="M 85 72 L 80 92 L 120 92 L 115 72 Z" fill="url(#fallback-emerald)" />

        {/* Upper Cowl Dome */}
        <path
          d="M 52 110 Q 100 88 148 110 L 158 135 Q 100 120 42 135 Z"
          fill="url(#fallback-emerald)"
          filter="url(#fallback-glow)"
        />

        {/* Central Core Chamber Glow Sphere */}
        <circle
          cx="100"
          cy="150"
          r="38"
          fill="url(#fallback-core)"
          filter="url(#fallback-glow)"
          className={isCharging ? "animate-pulse" : ""}
        />

        {/* Hot Center Core */}
        <circle cx="100" cy="150" r="16" fill="#ecfdf5" opacity="0.9" />

        {/* Front Aperture Ring */}
        <circle
          cx="100"
          cy="150"
          r="48"
          stroke="url(#fallback-emerald)"
          strokeWidth="10"
          fill="none"
        />

        {/* Top and Bottom Horizontal Flanges */}
        <rect x="52" y="96" width="96" height="12" rx="6" fill="url(#fallback-emerald)" />
        <rect x="52" y="192" width="96" height="12" rx="6" fill="url(#fallback-emerald)" />

        {/* Lower Reservoir Urn */}
        <path
          d="M 44 165 Q 100 180 156 165 L 146 205 Q 100 215 54 205 Z"
          fill="url(#fallback-emerald)"
        />

        {/* Stepped Pedestal Base */}
        <path
          d="M 48 206 L 36 226 L 164 226 L 152 206 Z"
          fill="url(#fallback-emerald)"
        />
        <rect x="30" y="226" width="140" height="10" rx="4" fill="url(#fallback-emerald)" />
      </svg>

      {/* Context lost / info banner */}
      {isContextLost && (
        <div className="mt-3 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-amber-300 text-xs font-mono">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>WebGL context lost — 2D battery active</span>
          {onRetryWebGL && (
            <button
              type="button"
              onClick={onRetryWebGL}
              className="ml-2 inline-flex items-center gap-1 text-[11px] underline hover:text-white cursor-pointer"
            >
              <RefreshCw className="w-3 h-3 animate-spin" />
              Restore
            </button>
          )}
        </div>
      )}

      {/* Charge Status Indicator */}
      <div className="mt-2 text-center font-mono">
        <span className="text-xs text-zinc-400">WILLPOWER CHARGE: </span>
        <span className="text-xs font-bold text-emerald-400">
          {chargePercentage}%
        </span>
      </div>
    </div>
  );
}

// ─── MAIN 3D INTERACTIVE COMPONENT ─────────────────────────────────────────────

export default function CentralPowerBatteryModel({
  chargePercentage = 100,
  chargeState = "full",
  interactive = true,
  enableDeviceTilt = true,
  className = "",
  style,
  forceFallback = false,
  onContextLost,
  onContextRestored,
  testId = "central-power-battery-model",
}: CentralPowerBatteryModelProps) {
  const [webglSupported, setWebglSupported] = useState(false);
  const [isContextLost, setIsContextLost] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const targetPointer = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const dragDeltaRef = useRef({ x: 0, y: 0 });

  // Normalized charge ratio [0.0 to 1.0]
  const chargeRatio = Math.max(0, Math.min(100, chargePercentage)) / 100;

  // 1. Proactive WebGL detection probe on client mount
  useEffect(() => {
    setIsMounted(true);
    if (typeof window === "undefined" || forceFallback) {
      setWebglSupported(false);
      return;
    }

    try {
      if (
        typeof window === "undefined" ||
        (!("WebGLRenderingContext" in window) &&
          !("WebGL2RenderingContext" in window))
      ) {
        setWebglSupported(false);
        return;
      }

      const probeCanvas = document.createElement("canvas");
      const gl =
        probeCanvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
        probeCanvas.getContext("webgl", { failIfMajorPerformanceCaveat: false });

      if (gl) {
        setWebglSupported(true);
      } else {
        setWebglSupported(false);
      }
    } catch {
      setWebglSupported(false);
    }
  }, [forceFallback]);

  // 2. Interactive Pointer Drag & Move Listeners
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      isDraggingRef.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [interactive],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (bounds) {
        targetPointer.current = {
          x: ((e.clientX - bounds.left) / bounds.width) * 2 - 1,
          y: -(((e.clientY - bounds.top) / bounds.height) * 2 - 1),
        };
      }

      if (interactive && isDraggingRef.current) {
        const deltaX = e.clientX - lastMousePos.current.x;
        const deltaY = e.clientY - lastMousePos.current.y;
        dragDeltaRef.current.x += deltaX;
        dragDeltaRef.current.y += deltaY;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    },
    [interactive],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignored
      }
    },
    [interactive],
  );

  // 3. Mobile Device Tilt (Gyroscope) Listeners
  useEffect(() => {
    if (!enableDeviceTilt || typeof window === "undefined") return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma !== null && e.beta !== null && !isDraggingRef.current) {
        // gamma: left-to-right tilt [-90 to 90]
        // beta: front-to-back tilt [-180 to 180]
        const tiltX = Math.max(-1, Math.min(1, (e.beta - 45) / 45));
        const tiltY = Math.max(-1, Math.min(1, e.gamma / 45));
        dragDeltaRef.current.x += tiltY * 0.5;
        dragDeltaRef.current.y += tiltX * 0.5;
      }
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => window.removeEventListener("deviceorientation", handleOrientation);
  }, [enableDeviceTilt]);

  // Context restore retry handler
  const handleRetryWebGL = useCallback(() => {
    setIsContextLost(false);
    onContextRestored?.();
  }, [onContextRestored]);

  const fallbackNode = (
    <CentralPowerBatterySvgFallback
      chargePercentage={chargePercentage}
      chargeState={chargeState}
      isContextLost={isContextLost}
      onRetryWebGL={handleRetryWebGL}
      className={className}
    />
  );

  if (!isMounted || !webglSupported || forceFallback || isContextLost) {
    return <div className={className} style={style}>{fallbackNode}</div>;
  }

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={`relative w-full h-full min-h-[300px] flex items-center justify-center select-none overflow-hidden touch-none cursor-grab active:cursor-grabbing ${className}`}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="region"
      aria-label="3D Green Lantern Central Power Battery Interactive Model"
    >
      <CentralPowerBatteryErrorBoundary fallback={fallbackNode}>
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0, 5.4], fov: 42 }}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            const canvas = gl.domElement;
            const handleContextLost = (e: Event) => {
              e.preventDefault();
              setIsContextLost(true);
              onContextLost?.();
            };
            const handleContextRestored = () => {
              setIsContextLost(false);
              onContextRestored?.();
            };

            canvas.addEventListener("webglcontextlost", handleContextLost);
            canvas.addEventListener(
              "webglcontextrestored",
              handleContextRestored,
            );
          }}
        >
          {/* Lighting Rig */}
          <ambientLight intensity={1.2} />
          <directionalLight
            position={[4, 6, 5]}
            intensity={2.8}
            color="#ecfdf5"
          />
          <directionalLight
            position={[-4, -3, 3]}
            intensity={1.2}
            color="#059669"
          />

          {/* 3D Central Power Battery Mesh with Volumetric God-Rays */}
          <BatteryMesh
            chargeRatio={chargeRatio}
            chargeState={chargeState}
            interactive={interactive}
            enableDeviceTilt={enableDeviceTilt}
            targetPointer={targetPointer}
            isDraggingRef={isDraggingRef}
            dragDeltaRef={dragDeltaRef}
          />
        </Canvas>
      </CentralPowerBatteryErrorBoundary>
    </div>
  );
}

// ─── STREAK / MILESTONE 3D BATTERY DIALOG ──────────────────────────────────────

export interface CentralPowerBatteryStreakDialogProps {
  isOpen: boolean;
  onClose: () => void;
  streak?: number;
  longestStreak?: number;
  milestoneTitle?: string;
}

export function CentralPowerBatteryStreakDialog({
  isOpen,
  onClose,
  streak = 7,
  longestStreak = 14,
  milestoneTitle = "Oan Willpower Battery Ceremony",
}: CentralPowerBatteryStreakDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const chargePercentage = Math.min(100, Math.round((streak / 10) * 100));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="battery-dialog-title"
      data-testid="central-power-battery-streak-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg p-6 sm:p-8 rounded-3xl bg-zinc-950/95 border border-emerald-500/40 shadow-[0_0_60px_rgba(16,185,129,0.3)] text-center space-y-5 overflow-hidden">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          data-testid="close-battery-dialog-btn"
          aria-label="Close battery streak dialog"
          className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800/80 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="space-y-1.5 pt-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono uppercase tracking-widest font-bold">
            <Sparkles className="w-3 h-3 text-emerald-400 animate-pulse" />
            Central Power Battery Milestone
          </div>
          <h3
            id="battery-dialog-title"
            className="text-xl sm:text-2xl font-black text-white tracking-tight uppercase font-mono"
          >
            {milestoneTitle}
          </h3>
          <p className="text-xs text-zinc-400 font-mono">
            {streak}-Day Continuous Willpower Streak (Longest: {longestStreak} Days)
          </p>
        </div>

        {/* 3D Interactive Power Battery Model */}
        <div className="w-full h-64 sm:h-72 my-2 flex items-center justify-center rounded-2xl bg-zinc-900/40 border border-emerald-500/20 overflow-hidden">
          <CentralPowerBatteryModel
            chargePercentage={chargePercentage}
            chargeState={chargePercentage >= 100 ? "full" : "charging"}
            interactive={true}
            enableDeviceTilt={true}
          />
        </div>

        {/* Instruction badge */}
        <div className="text-[11px] font-mono text-zinc-400 flex items-center justify-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          Drag to rotate in 3D • Tilt device to sway energy rings
        </div>

        {/* Charge Progress Meter */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span>WILLPOWER BATTERY CHARGE</span>
            <span className="text-emerald-400 font-bold">{chargePercentage}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)] rounded-full transition-all duration-500"
              style={{ width: `${chargePercentage}%` }}
            />
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)] cursor-pointer"
          >
            Channel Willpower // Close Ceremony
          </button>
        </div>
      </div>
    </div>
  );
}
