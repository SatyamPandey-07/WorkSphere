"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as THREE from "three";
import { useWebXR } from "@/hooks/useWebXR";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { usePredictiveGyroscope } from "@/hooks/usePredictiveGyroscope";
import { normalizeAngle } from "@/lib/geometry/bearing";
import {
  calculate3DDistance,
  applyDistanceSmoothing,
  formatElevationIndicator,
  Vector3,
} from "@/types/ar";
import CompassFallback from "./CompassFallback";
import { Eye, Layers, Navigation, Compass } from "lucide-react";
import { drawRadarOverlay } from "@/lib/ar/radarCanvas";

export interface SeatARPointerProps {
  /** Target reserved seat information */
  seatNumber?: string;
  targetSeatNumber?: string;
  seatId?: string;
  venueName?: string;
  /** Floor level (e.g., 2 for Floor 2) */
  floorLevel?: number;
  targetFloor?: number;
  /** Target seat position (x, y, z in meters) */
  targetPosition?: { x: number; y: number; z: number };
  /** Current user position (x, y, z in meters) */
  userPosition?: { x: number; y: number; z: number };
  /** Current user altitude in meters relative to ground plane */
  userAltitude?: number;
  /** Current barometric pressure reading in hPa / mbar */
  currentPressureHpa?: number;
  /** Baseline ground plane pressure in hPa (default: 1013.25) */
  baselinePressureHpa?: number;
  /** Height per floor in meters (default: 3.5m) */
  floorHeightMeters?: number;
  /** Distance threshold in meters to consider reached floor (default: 1.5m) */
  verticalThresholdMeters?: number;
  /** Callback when user successfully arrives on the correct floor */
  onFloorReached?: (floor: number) => void;
  /** Smoothing factor alpha for low-pass distance filter (0.01 to 1.0, default 0.2) */
  smoothingAlpha?: number;
  /** Spatial target anchor coordinates in local AR metric space */
  targetAnchor?: Vector3;
  /** Spatial user camera initial position */
  userAnchor?: Vector3;
  /** Target seat GPS coordinates (if outdoors/large campus) */
  targetGps?: {
    latitude: number;
    longitude: number;
  };
  onClose?: () => void;
}

// Stable defaults: inline object literals would change identity every render
// and re-run the effects that depend on them.
const DEFAULT_TARGET_POSITION = { x: 0, y: 0.8, z: -3 };
const DEFAULT_USER_POSITION = { x: 0, y: 1.2, z: 0 };

/** Standard barometric altitude formula (hypsometric approximation) */
export function calculateBarometricAltitude(
  currentHpa: number,
  baselineHpa = 1013.25,
): number {
  if (currentHpa <= 0 || baselineHpa <= 0) return 0;
  // 44330 * (1 - (P / P0)^(1 / 5.255))
  const altitude = 44330 * (1 - Math.pow(currentHpa / baselineHpa, 1 / 5.255));
  return Number.isFinite(altitude) ? altitude : 0;
}

/** Calculates estimated floor from altitude */
export function calculateFloorFromAltitude(
  altitudeMeters: number,
  floorHeightMeters = 3.5,
  baseFloor = 1,
): number {
  if (floorHeightMeters <= 0) return baseFloor;
  const floorDelta = Math.round(altitudeMeters / floorHeightMeters);
  return baseFloor + floorDelta;
}

/**
 * SeatARPointer (#3956, #4413, #4831):
 * For supported mobile devices with WebXR camera access, projects a floating
 * 3D directional arrow pointing towards the user's reserved seat anchor in AR space.
 * Includes multi-floor indoor altitude detection using barometric pressure changes or step altitude,
 * guiding users between floors in multi-story coworking venues with directional badges.
 *
 * Updated to use predictive gyroscope smoothing to eliminate visual overshoot during rapid rotation.
 */
export function SeatARPointer({
  seatNumber: propSeatNumber,
  targetSeatNumber,
  seatId: _seatId,
  venueName: _venueName,
  floorLevel: propFloorLevel,
  targetFloor: propTargetFloor,
  targetPosition = DEFAULT_TARGET_POSITION,
  userPosition = DEFAULT_USER_POSITION,
  userAltitude,
  currentPressureHpa,
  baselinePressureHpa = 1013.25,
  floorHeightMeters = 3.5,
  verticalThresholdMeters = 1.5,
  onFloorReached,
  smoothingAlpha = 0.2,
  targetAnchor: propTargetAnchor,
  userAnchor: _userAnchor,
  targetGps,
  onClose,
}: SeatARPointerProps) {
  const seatLabel = targetSeatNumber ?? propSeatNumber ?? "1A";
  const targetFloorNum = propTargetFloor ?? propFloorLevel ?? 1;
  const targetAnchorVec: Vector3 = propTargetAnchor ?? targetPosition;

  const { isSupported, requestSession } = useWebXR();
  const { heading } = useDeviceOrientation();

  // Use predictive gyroscope hook for smooth, lag-free rotation stabilization
  // Time constant of 0.15s provides a balance between responsiveness and jitter reduction
  const predictiveQuaternion = usePredictiveGyroscope(0.15);

  const containerRef = useRef<HTMLDivElement>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);
  const [_xrSession, setXrSession] = useState<XRSession | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [showRadar, setShowRadar] = useState(true);
  const [distanceToSeat, setDistanceToSeat] = useState<number>(3.0);
  const [, setElevationDelta] = useState<number>(0);
  const [elevationText, setElevationText] =
    useState<string>("Same Level (+0.0m)");
  const [bearingAngle, setBearingAngle] = useState<number>(0);

  const prevDistanceRef = useRef<number | null>(null);

  // Compute effective user elevation relative to ground plane
  const currentElevation = useMemo(() => {
    if (typeof userAltitude === "number") {
      return userAltitude;
    }
    if (typeof currentPressureHpa === "number") {
      return calculateBarometricAltitude(
        currentPressureHpa,
        baselinePressureHpa,
      );
    }
    return userPosition.y || 0;
  }, [userAltitude, currentPressureHpa, baselinePressureHpa, userPosition.y]);

  // Target elevation based on floor (ground floor = floor 1 = 0m elevation)
  const targetElevation =
    (targetFloorNum - 1) * floorHeightMeters + (targetPosition.y || 0);
  const floorElevationDelta = targetElevation - currentElevation;
  const estimatedCurrentFloor = calculateFloorFromAltitude(
    currentElevation,
    floorHeightMeters,
    1,
  );

  const isWrongLevel = Math.abs(floorElevationDelta) > verticalThresholdMeters;
  const needToGoUp = floorElevationDelta > 0;

  useEffect(() => {
    if (!isWrongLevel && onFloorReached) {
      onFloorReached(targetFloorNum);
    }
  }, [isWrongLevel, targetFloorNum, onFloorReached]);

  // Fallback to CompassFallback if WebXR is explicitly unsupported
  const isWebXRUnavailable = isSupported === false;

  // Initialize WebXR or Device Orientation projection
  const startARSession = useCallback(async () => {
    try {
      const session = await requestSession();
      if (session) {
        setXrSession(session);
        setSessionActive(true);
      }
    } catch (err) {
      console.warn(
        "[SeatARPointer] WebXR session request rejected or unsupported:",
        err,
      );
    }
  }, [requestSession]);

  // Memoize Arrow Geometry and Material for performance
  const arrowGeometry = useMemo(() => {
    const geometry = new THREE.ConeGeometry(0.12, 0.35, 32);
    // Rotate to point forward along Z axis initially if needed,
    // but we handle orientation in lookAt/rotation logic below
    return geometry;
  }, []);

  const shaftGeometry = useMemo(() => {
    return new THREE.CylinderGeometry(0.04, 0.04, 0.35, 16);
  }, []);

  const ringGeometry = useMemo(() => {
    return new THREE.RingGeometry(0.2, 0.25, 32);
  }, []);

  const arrowMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.3,
    });
  }, []);

  const ringMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
  }, []);

  // Set up Three.js 3D Arrow scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.01, 20);
    camera.position.set(0, 1.2, 0); // user eye level

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // Ambient & directional lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0x3b82f6, 1.5);
    dirLight.position.set(0, 5, 2);
    scene.add(dirLight);

    // Create 3D Arrow Mesh pointing towards seat anchor
    const arrowGroup = new THREE.Group();

    // Arrow Cone Tip
    const cone = new THREE.Mesh(arrowGeometry, arrowMaterial);
    cone.position.set(0, 0.4, 0);

    // Arrow Shaft Cylinder
    const shaft = new THREE.Mesh(shaftGeometry, arrowMaterial);
    shaft.position.set(0, 0.15, 0);

    // Pulsing target locator ring on floor
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0, 0);

    arrowGroup.add(cone);
    arrowGroup.add(shaft);
    arrowGroup.add(ring);
    scene.add(arrowGroup);

    // Floating Target Seat Anchor Marker
    const targetVector = new THREE.Vector3(
      targetAnchorVec.x,
      targetAnchorVec.y,
      targetAnchorVec.z,
    );

    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      const elapsedTime = clock.getElapsedTime();

      // Floating bobbing effect
      arrowGroup.position.y = 1.0 + Math.sin(elapsedTime * 2.5) * 0.08;

      // Compute heading transform matrix & 3D Euclidean distance towards seat anchor
      const currentCameraPos = camera.position;
      const userPosVec: Vector3 = {
        x: currentCameraPos.x,
        y: currentCameraPos.y,
        z: currentCameraPos.z,
      };
      const targetPosVec: Vector3 = {
        x: targetVector.x,
        y: targetVector.y,
        z: targetVector.z,
      };

      const metrics = calculate3DDistance(userPosVec, targetPosVec);
      const smoothed = applyDistanceSmoothing(
        metrics.distance3D,
        prevDistanceRef.current,
        smoothingAlpha,
      );
      prevDistanceRef.current = smoothed;

      setDistanceToSeat(smoothed);
      setElevationDelta(Math.round(metrics.elevationDelta * 10) / 10);
      setElevationText(
        formatElevationIndicator(metrics.elevationDelta, targetFloorNum),
      );

      const dirToTarget = new THREE.Vector3().subVectors(
        targetVector,
        currentCameraPos,
      );

      // Compute normalized bearing angle
      const rad = Math.atan2(dirToTarget.x, -dirToTarget.z);
      const deg = normalizeAngle((rad * 180) / Math.PI);
      setBearingAngle(Math.round(deg));

      // Orient arrow towards target anchor
      arrowGroup.position.set(0, 0.8, -1.2);

      // Apply predictive gyroscope smoothing to eliminate visual overshoot
      if (predictiveQuaternion) {
        arrowGroup.quaternion.set(
          predictiveQuaternion[0],
          predictiveQuaternion[1],
          predictiveQuaternion[2],
          predictiveQuaternion[3],
        );
      } else {
        // Fallback to standard lookAt if predictive data isn't available yet
        arrowGroup.lookAt(
          targetVector.x,
          arrowGroup.position.y,
          targetVector.z,
        );
      }

      arrowGroup.rotateX(Math.PI / 6);

      const pulse = 1 + Math.sin(elapsedTime * 4) * 0.15;
      ring.scale.set(pulse, pulse, pulse);

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      // Geometries and materials are memoized outside, so we don't dispose them here
      // to allow reuse if component re-mounts quickly, but strictly speaking
      // in a pure unmount scenario we should. Given they are useMemo'd at component level,
      // they persist across re-renders. If strict cleanup is needed, move them inside.
    };
  }, [
    targetAnchorVec,
    targetFloorNum,
    smoothingAlpha,
    predictiveQuaternion,
    arrowGeometry,
    shaftGeometry,
    ringGeometry,
    arrowMaterial,
    ringMaterial,
  ]);

  // Synchronous 2D Radar Canvas drawing loop
  useEffect(() => {
    if (!showRadar) return;
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const renderRadar = () => {
      drawRadarOverlay(ctx, {
        size: 130,
        maxRangeMeters: 10,
        heading: heading ?? 0,
        bearingAngle,
        distance: distanceToSeat,
        pulseTime: Date.now() / 1000,
        seatLabel,
      });
      animId = requestAnimationFrame(renderRadar);
    };

    animId = requestAnimationFrame(renderRadar);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [showRadar, heading, bearingAngle, distanceToSeat, seatLabel]);

  if (isWebXRUnavailable) {
    return (
      <div className="relative w-full h-full min-h-[400px]">
        {/* Multi-floor altitude guidance banner */}
        {isWrongLevel && (
          <div
            data-testid="vertical-floor-guidance-badge"
            className="absolute top-4 inset-x-4 z-30 flex items-center justify-center p-3 rounded-2xl bg-amber-600/90 text-white backdrop-blur-md shadow-xl border border-amber-400/40 animate-pulse pointer-events-auto"
          >
            <div className="flex flex-col text-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
                Vertical Elevation:{" "}
                {floorElevationDelta > 0
                  ? `+${floorElevationDelta.toFixed(1)}m`
                  : `${floorElevationDelta.toFixed(1)}m`}
              </span>
              <span className="text-sm font-bold">
                {needToGoUp
                  ? `Take Elevator / Stairs to Floor ${targetFloorNum}`
                  : `Take Elevator / Stairs to Floor ${targetFloorNum}`}
              </span>
              <span className="text-[11px] text-amber-100/90">
                Current Level: Floor {estimatedCurrentFloor} · Target: Floor{" "}
                {targetFloorNum}
              </span>
            </div>
          </div>
        )}
        <CompassFallback
          destinationLat={targetGps?.latitude}
          destinationLng={targetGps?.longitude}
          destinationName={`Seat ${seatLabel}`}
          onClose={onClose}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="seat-ar-pointer-container"
      className="relative w-full h-full min-h-[420px] bg-black/90 overflow-hidden select-none pointer-events-none"
    >
      {/* Multi-Floor Directional Guidance Badge */}
      {isWrongLevel ? (
        <div
          data-testid="vertical-floor-guidance-badge"
          className="absolute top-4 inset-x-4 z-30 mx-auto max-w-md flex items-center justify-center p-4 rounded-2xl bg-amber-600/95 text-white backdrop-blur-md shadow-2xl border border-amber-400/50 animate-pulse pointer-events-auto"
        >
          <div className="flex flex-col text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              Vertical Elevation:{" "}
              {floorElevationDelta > 0
                ? `+${floorElevationDelta.toFixed(1)}m`
                : `${floorElevationDelta.toFixed(1)}m`}
            </span>
            <span className="text-sm font-bold">
              {needToGoUp
                ? `Take Elevator / Stairs to Floor ${targetFloorNum}`
                : `Take Elevator / Stairs to Floor ${targetFloorNum}`}
            </span>
            <span className="text-[11px] text-amber-100/90 mt-0.5">
              Current Level: Floor {estimatedCurrentFloor} · Target: Floor{" "}
              {targetFloorNum}
            </span>
          </div>
        </div>
      ) : (
        /* On Target Level Seat Pointer Indicator */
        <div
          data-testid="seat-direction-pointer"
          className="absolute top-4 left-4 z-20 pointer-events-auto flex flex-col gap-1 px-4 py-2 rounded-xl bg-blue-600/90 text-white backdrop-blur-md shadow-lg border border-blue-400/30"
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-ping" />
            <span className="text-sm font-semibold">Seat {seatLabel}</span>
          </div>
          <span className="text-xs text-blue-100">
            Floor {targetFloorNum} (On Target Level)
          </span>
        </div>
      )}

      {/* Floating HUD Header */}
      <div className="absolute top-4 inset-x-4 z-20 flex items-start justify-between pointer-events-none">
        <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl bg-slate-900/80 backdrop-blur-md border border-slate-700 shadow-xl pointer-events-auto min-w-[200px]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs font-bold text-slate-100">
                Seat {seatLabel}
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {bearingAngle}°
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-blue-400 border-t border-slate-800 pt-1.5">
            <div className="flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-blue-400" />
              <span>{distanceToSeat.toFixed(1)}m away</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-mono">
              <Layers className="w-3 h-3 text-emerald-400" />
              <span>{elevationText}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Radar Overlay Toggle Button */}
          <button
            type="button"
            onClick={() => setShowRadar((prev) => !prev)}
            title={showRadar ? "Hide 2D Radar" : "Show 2D Radar"}
            aria-label={showRadar ? "Hide 2D Radar" : "Show 2D Radar"}
            aria-pressed={showRadar}
            data-testid="toggle-radar-btn"
            className={`p-2 rounded-xl backdrop-blur-md border transition flex items-center gap-1.5 text-xs font-medium ${
              showRadar
                ? "bg-blue-600/80 border-blue-500 text-white shadow-lg shadow-blue-500/20"
                : "bg-slate-900/80 border-slate-700 text-slate-300 hover:text-white"
            }`}
          >
            <Compass className="w-4 h-4" />
            <span className="hidden sm:inline">Radar</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-700 text-slate-300 hover:text-white transition"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Mini 2D Radar Overlay in Bottom Corner */}
      {showRadar && (
        <div
          data-testid="radar-overlay-container"
          className="absolute bottom-16 right-4 z-20 pointer-events-auto flex flex-col items-end gap-1.5 animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="relative rounded-full p-1 bg-slate-950/80 backdrop-blur-md border border-sky-500/30 shadow-2xl shadow-sky-950/50">
            <canvas
              ref={radarCanvasRef}
              width={130}
              height={130}
              className="block rounded-full"
              data-testid="radar-canvas"
              aria-label="2D Radar mini-map showing seat position"
            />
            {/* Compass Azimuth indicator badge on radar */}
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-slate-900/90 border border-sky-400/30 text-[9px] font-mono text-sky-300 shadow">
              {Math.round(heading ?? 0)}°
            </div>
          </div>
        </div>
      )}

      {/* Controls Footer */}
      <div className="absolute bottom-6 inset-x-4 z-20 flex flex-col items-center gap-3 pointer-events-none">
        {!sessionActive && isSupported && (
          <button
            onClick={startARSession}
            className="pointer-events-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-500 text-white shadow-xl transition"
          >
            <Eye className="w-4 h-4" />
            Launch Immersive AR Camera
          </button>
        )}

        <div className="px-3.5 py-1.5 rounded-lg bg-slate-900/90 backdrop-blur-md border border-slate-800 text-[11px] text-slate-300">
          Point phone camera around room to locate your reserved seat
        </div>
      </div>
    </div>
  );
}

export default SeatARPointer;
