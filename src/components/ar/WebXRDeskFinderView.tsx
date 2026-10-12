"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Camera,
  Navigation,
  Compass,
  CheckCircle2,
  Layers,
  ArrowUp,
  Footprints,
  RotateCcw,
  Target,
  Crosshair,
  Anchor,
  Scan,
} from "lucide-react";
import {
  calculate3DDistance,
  clampCameraOrientation,
  AdaptiveWayfindingKalmanFilter,
  type ARNavigationPath,
  type ARCameraFallbackMode,
  type Vector3D,
  type PositioningSensorMetrics,
  type PositioningSourceMode,
} from "@/lib/spatial/arWayfindingEngine";

/**
 * Calculates HUD badge opacity smoothly fading when distance <= 1.5m.
 */
export function calculateDeskBadgeOpacity(distanceMeters: number): number {
  if (distanceMeters <= 0) return 0;
  if (distanceMeters >= 1.5) return 1;
  return Number((distanceMeters / 1.5).toFixed(3));
}

/**
 * Calculates estimated indoor walking time in seconds based on Euclidean distance.
 */
export function calculateEstimatedWalkingSeconds(
  distanceMeters: number,
  paceMps = 1.1,
): number {
  if (distanceMeters <= 0) return 0;
  return Math.max(0, Math.round(distanceMeters / paceMps));
}

export interface HitTestSurfaceResult {
  position: Vector3D;
  normal: Vector3D;
  surfaceType: "tabletop" | "floor" | "horizontal_plane";
  confidence: number;
  distanceMeters: number;
  matrix?: number[];
}

/**
 * Calculates surface normal from a 4x4 transform matrix, falling back to horizontal up normal [0, 1, 0].
 */
export function calculateSurfaceNormal(
  matrix?: number[] | Float32Array,
): Vector3D {
  if (!matrix || matrix.length < 16) {
    return { x: 0, y: 1, z: 0 };
  }
  const nx = matrix[4];
  const ny = matrix[5];
  const nz = matrix[6];
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0 || !Number.isFinite(len)) {
    return { x: 0, y: 1, z: 0 };
  }
  return {
    x: Number((nx / len).toFixed(3)),
    y: Number((ny / len).toFixed(3)),
    z: Number((nz / len).toFixed(3)),
  };
}

interface WebXRDeskFinderViewProps {
  venueId?: string;
  venueName?: string;
  targetSeatNumber?: string;
  initialSensorMetrics?: PositioningSensorMetrics;
  autoStartHitTest?: boolean;
  onAnchorConfirmed?: (coords: Vector3D) => void;
}

export default function WebXRDeskFinderView({
  venueId = "venue-sf-hub",
  venueName: _venueName = "Mission Bay Coworking Hub",
  targetSeatNumber = "Desk B-08 (Window Pod)",
  initialSensorMetrics = {
    gpsHdop: 1.2,
    gpsAccuracyMeters: 3.5,
    wifiRssiVariance: 4.0,
    beaconCount: 3,
  },
  autoStartHitTest = false,
  onAnchorConfirmed,
}: WebXRDeskFinderViewProps) {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [userPose, setUserPose] = useState<Vector3D>({ x: 0, y: 0, z: 0 });
  const [cameraOffset, setCameraOffset] = useState<Vector3D>({
    x: 0,
    y: 0,
    z: 0,
  });
  const [navPath, setNavPath] = useState<ARNavigationPath | null>(null);
  const [_loading, setLoading] = useState(true);
  const [_arActive, _setArActive] = useState(true);
  const [_arSupported, setArSupported] = useState(true);
  const [bearingDeg, setBearingDeg] = useState(35); // simulated bearing to target
  const [_fallbackMode, setFallbackMode] =
    useState<ARCameraFallbackMode>("horizon_locked");
  const [isCompassReliable, setIsCompassReliable] = useState<boolean>(true);
  const [positioningMode, setPositioningMode] =
    useState<PositioningSourceMode>("GPS_DOMINANT");
  const [sensorMetrics] =
    useState<PositioningSensorMetrics>(initialSensorMetrics);

  // WebXR Hit-Test and Anchoring State
  const [isWebXRMode, setIsWebXRMode] = useState<boolean>(false);
  const [hitTestActive, setHitTestActive] = useState<boolean>(autoStartHitTest);
  const [hitTestResult, setHitTestResult] =
    useState<HitTestSurfaceResult | null>(null);
  const [anchoredPosition, setAnchoredPosition] = useState<Vector3D | null>(
    null,
  );
  const [isAnchored, setIsAnchored] = useState<boolean>(false);

  const xrSessionRef = useRef<any>(null);
  const hitTestSourceRef = useRef<any>(null);

  const kalmanFilterRef = useRef<AdaptiveWayfindingKalmanFilter | null>(null);
  if (!kalmanFilterRef.current) {
    kalmanFilterRef.current = new AdaptiveWayfindingKalmanFilter({
      x: 0,
      y: 0,
      z: 0,
    });
  }

  // Video feed ref for real camera if permissions granted
  const videoRef = useRef<HTMLVideoElement>(null);

  const fetchARRoute = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ar/wayfinding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          currentPosition: userPose,
          targetSeatNumber,
        }),
      });
      const data = await res.json();
      if (data.success && data.route) {
        setNavPath(data.route);
      }
    } catch (err) {
      console.error("Failed to load AR route:", err);
    } finally {
      setLoading(false);
    }
  }, [venueId, userPose, targetSeatNumber]);

  useEffect(() => {
    fetchARRoute();
  }, [fetchARRoute]);

  // Request real camera stream if available in browser
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      navigator.mediaDevices?.getUserMedia
    ) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(() => {
          // Camera permission denied or mock environment fallback
          setArSupported(false);
        });
    }
  }, []);

  // Request WebXR session with hit-test feature
  const enterWebXRMode = async () => {
    if (
      typeof navigator !== "undefined" &&
      "xr" in navigator &&
      (navigator as any).xr
    ) {
      try {
        const session = await (navigator as any).xr.requestSession(
          "immersive-ar",
          {
            requiredFeatures: ["hit-test"],
            optionalFeatures: ["local-floor", "anchors", "dom-overlay"],
          },
        );
        xrSessionRef.current = session;
        setIsWebXRMode(true);
        setHitTestActive(true);

        // Request Hit Test Source
        try {
          const viewerSpace = await session.requestReferenceSpace("viewer");
          const source = await session.requestHitTestSource({
            space: viewerSpace,
            entityTypes: ["plane", "point"],
          });
          hitTestSourceRef.current = source;
        } catch (srcErr) {
          console.warn(
            "[WebXR] Hit test source request deferred or unsupported:",
            srcErr,
          );
        }

        session.addEventListener("end", () => {
          xrSessionRef.current = null;
          hitTestSourceRef.current = null;
          setIsWebXRMode(false);
          setHitTestActive(false);
        });
      } catch (err) {
        console.warn(
          "[WebXR] immersive-ar session request failed, running simulated WebXR mode:",
          err,
        );
        setIsWebXRMode(true);
        setHitTestActive(true);
      }
    } else {
      // Fallback for non-XR browsers/mocks
      setIsWebXRMode(true);
      setHitTestActive(true);
    }
  };

  // Compute or simulate surface hit test coordinates on camera / pointer move
  const updateHitTestSurface = useCallback((offset: Vector3D) => {
    // Horizontal tabletop plane ~0.4m below camera, ~1.8m ahead
    const simulatedPosition: Vector3D = {
      x: Number((offset.x * 1.5).toFixed(2)),
      y: -0.4,
      z: Number((-1.8 + offset.y * 0.8).toFixed(2)),
    };
    const normal: Vector3D = { x: 0, y: 1, z: 0 }; // detected horizontal surface normal
    const dist = Math.sqrt(
      simulatedPosition.x * simulatedPosition.x +
        simulatedPosition.y * simulatedPosition.y +
        simulatedPosition.z * simulatedPosition.z,
    );

    setHitTestResult({
      position: simulatedPosition,
      normal,
      surfaceType: "tabletop",
      confidence: 0.94,
      distanceMeters: Number(dist.toFixed(2)),
    });
  }, []);

  // Real-time camera movement tracking (pointer and device orientation)
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const clientX = Number.isFinite(e.clientX) ? e.clientX : 0;
    const clientY = Number.isFinite(e.clientY) ? e.clientY : 0;
    const relX = (clientX - rect.left) / rect.width - 0.5;
    const relY = (clientY - rect.top) / rect.height - 0.5;

    // Convert pointer delta into bounded simulated tilt angles
    const simBeta = -relY * 60; // Pitch clamped [-30°, 30°]
    const simGamma = relX * 60; // Roll clamped [-30°, 30°]
    const clamped = clampCameraOrientation(simBeta, simGamma);

    setCameraOffset(clamped.offset);
    setFallbackMode(clamped.fallbackMode);
    setIsCompassReliable(true);

    if (hitTestActive && !isAnchored) {
      updateHitTestSurface(clamped.offset);
    }
  };

  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const clamped = clampCameraOrientation(e.beta, e.gamma);
      setCameraOffset(clamped.offset);
      setFallbackMode(clamped.fallbackMode);
      setIsCompassReliable(clamped.isCompassReliable);
      if (hitTestActive && !isAnchored) {
        updateHitTestSurface(clamped.offset);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("deviceorientation", handleOrientation);
      return () => {
        window.removeEventListener("deviceorientation", handleOrientation);
      };
    }
  }, [hitTestActive, isAnchored, updateHitTestSurface]);

  // Initial surface calculation when hit-testing is activated
  useEffect(() => {
    if (hitTestActive && !hitTestResult) {
      updateHitTestSurface(cameraOffset);
    }
  }, [hitTestActive, hitTestResult, cameraOffset, updateHitTestSurface]);

  // Anchor 3D desk reservation badge onto confirmed hit test coordinates
  const handleAnchorToSurface = () => {
    const coords = hitTestResult?.position ?? {
      x: Number((cameraOffset.x * 1.5).toFixed(2)),
      y: -0.4,
      z: -1.8,
    };
    setAnchoredPosition(coords);
    setIsAnchored(true);
    onAnchorConfirmed?.(coords);
  };

  const handleResetAnchor = () => {
    setIsAnchored(false);
    setAnchoredPosition(null);
    updateHitTestSurface(cameraOffset);
  };

  // Simulate walking along the AR waypoints
  const handleNextStep = () => {
    if (!navPath) return;
    if (currentStep < navPath.waypoints.length - 1) {
      const nextIdx = currentStep + 1;
      setCurrentStep(nextIdx);
      const nextWaypoint = navPath.waypoints[nextIdx];

      // Update position through adaptive Kalman filter to eliminate GPS/WiFi transition drift
      if (kalmanFilterRef.current) {
        kalmanFilterRef.current.predict();
        const updateResult = kalmanFilterRef.current.update({
          wifiPosition: nextWaypoint.position,
          gpsPosition: nextWaypoint.position,
          metrics: sensorMetrics,
        });
        setUserPose(updateResult.filteredPosition);
        setPositioningMode(updateResult.covarianceWeights.mode);
      } else {
        setUserPose(nextWaypoint.position);
      }

      // Reduce distance and adjust angle
      setBearingDeg((prev) => Math.max(0, prev - 15));
    }
  };

  const handleResetWalk = () => {
    setCurrentStep(0);
    setUserPose({ x: 0, y: 0, z: 0 });
    setCameraOffset({ x: 0, y: 0, z: 0 });
    setBearingDeg(35);
    setIsAnchored(false);
    setAnchoredPosition(null);
    if (kalmanFilterRef.current) {
      kalmanFilterRef.current.reset({ x: 0, y: 0, z: 0 });
    }
  };

  const activeWaypoint = navPath?.waypoints[currentStep];
  const isArrived =
    activeWaypoint?.turnAction === "ARRIVED" ||
    currentStep === (navPath?.waypoints.length ?? 1) - 1;

  // Real-time Euclidean distance recalculation on camera move
  const currentCameraPosition: Vector3D = {
    x: userPose.x + cameraOffset.x,
    y: userPose.y + cameraOffset.y,
    z: userPose.z + cameraOffset.z,
  };
  const targetPosition: Vector3D = navPath?.targetPosition ?? {
    x: 5.4,
    y: 0,
    z: -8.2,
  };
  const rawRemainingDistance = calculate3DDistance(
    currentCameraPosition,
    targetPosition,
  );
  const remainingDistanceMeters = isArrived
    ? 0
    : Math.max(0, Number(rawRemainingDistance.toFixed(1)));
  const estimatedWalkingSeconds = calculateEstimatedWalkingSeconds(
    remainingDistanceMeters,
  );
  const badgeOpacity = isArrived
    ? 0
    : calculateDeskBadgeOpacity(remainingDistanceMeters);

  // Surface hit test display position
  const activeSurfacePos = isAnchored
    ? anchoredPosition
    : (hitTestResult?.position ?? null);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold uppercase tracking-wider">
              <Camera className="w-3.5 h-3.5 animate-pulse" /> WebXR Indoor AR
              Wayfinding
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Indoor AR Desk Finder & Waypoint HUD
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Spatial anchor positioning and directional 3D path vectors guide
              you from the venue entrance directly to your reserved desk.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* Enter WebXR Mode / Hit-Test Button */}
            {!isWebXRMode && (
              <button
                type="button"
                data-testid="enter-webxr-btn"
                onClick={enterWebXRMode}
                className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 transition active:scale-95"
              >
                <Scan className="w-4 h-4" />
                Enter WebXR AR
              </button>
            )}

            <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs font-mono space-y-1">
              <span className="text-slate-500 block text-[10px]">
                Target Destination
              </span>
              <strong className="text-cyan-400 text-sm block">
                {targetSeatNumber}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Main AR Viewport Container */}
      <div
        onPointerMove={handlePointerMove}
        className="relative w-full h-[520px] rounded-3xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl flex flex-col justify-between"
      >
        {/* Background Camera Feed / Mock Workspace Canvas */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover opacity-60"
          />

          {/* Perspective 3D Hallway Grid Simulation */}
          <div className="absolute inset-0 bg-[radial-gradient(#0ea5e9_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />

          {/* Floating Glowing AR Waypoint Markers */}
          <div className="absolute flex flex-col items-center justify-center space-y-3 transition-all duration-500">
            {/* Floating Distance & Estimated Walking Time HUD Badge above the Target Desk */}
            <div
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-cyan-400/50 text-cyan-300 text-xs font-mono shadow-lg shadow-cyan-950/60 backdrop-blur-md transition-opacity duration-300 pointer-events-none"
              style={{ opacity: badgeOpacity }}
              data-testid="desk-hud-distance-badge"
              aria-label={`Distance ${remainingDistanceMeters.toFixed(1)} meters, ${estimatedWalkingSeconds} seconds walking time`}
            >
              <Footprints className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span className="font-bold text-white font-mono">
                {remainingDistanceMeters.toFixed(1)}m
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-cyan-200 font-mono">
                {estimatedWalkingSeconds}s walk
              </span>
            </div>

            {/* 3D Glowing AR Arrow */}
            <div
              className={`flex items-center justify-center w-20 h-20 rounded-full transition-transform duration-500 ${
                isArrived
                  ? "bg-emerald-500/20 border-2 border-emerald-400 text-emerald-400 scale-125 shadow-lg shadow-emerald-500/40"
                  : "bg-cyan-500/20 border-2 border-cyan-400 text-cyan-300 animate-bounce shadow-lg shadow-cyan-500/30"
              }`}
              style={{
                transform: `rotate(${isArrived ? 0 : bearingDeg}deg)`,
              }}
            >
              {isArrived ? (
                <CheckCircle2 className="w-10 h-10" />
              ) : (
                <ArrowUp className="w-10 h-10 stroke-[2.5]" />
              )}
            </div>

            {/* Glowing Desk Bounding Box (when not yet anchored to physical surface) */}
            {!isAnchored && (
              <div
                className={`px-6 py-4 rounded-2xl border-2 backdrop-blur-md transition-all duration-300 text-center ${
                  isArrived
                    ? "bg-emerald-950/80 border-emerald-400 shadow-xl shadow-emerald-950/50"
                    : "bg-slate-900/80 border-cyan-400 shadow-xl shadow-cyan-950/40"
                }`}
              >
                <span className="text-[10px] uppercase font-bold tracking-widest text-cyan-300 block">
                  {isArrived ? "DESTINATION REACHED" : "SPATIAL ANCHOR LOCKED"}
                </span>
                <h3 className="text-base font-extrabold text-white">
                  {targetSeatNumber}
                </h3>
                <span className="text-xs font-mono text-slate-300">
                  {isArrived
                    ? "Checked In at Desk"
                    : `~${remainingDistanceMeters.toFixed(1)}m Ahead (${estimatedWalkingSeconds}s)`}
                </span>
              </div>
            )}
          </div>

          {/* WebXR Hit-Testing Holographic Surface Reticle */}
          {hitTestActive && !isAnchored && (
            <div
              data-testid="ar-hit-test-reticle"
              onClick={handleAnchorToSurface}
              style={{
                transform: `perspective(600px) rotateX(70deg) translate3d(${cameraOffset.x * 40}px, ${cameraOffset.y * 20}px, 0)`,
              }}
              className="absolute bottom-16 flex flex-col items-center justify-center cursor-pointer group transition-transform duration-200"
            >
              {/* Directional Shadow Plane beneath Reticle on Tabletop/Floor */}
              <div
                data-testid="reticle-shadow-plane"
                className="absolute w-44 h-44 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.65)_0%,rgba(0,0,0,0)_70%)] pointer-events-none scale-y-50"
              />

              {/* Holographic Concentric Reticle Rings */}
              <div className="relative flex items-center justify-center w-36 h-36 rounded-full border-2 border-cyan-400/80 shadow-[0_0_25px_rgba(6,182,212,0.6)] animate-pulse">
                <div className="w-24 h-24 rounded-full border border-cyan-300/60 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full border border-dashed border-cyan-200/90 flex items-center justify-center">
                    <Crosshair className="w-6 h-6 text-cyan-300" />
                  </div>
                </div>

                {/* 4 Orientation Target Brackets */}
                <div className="absolute top-1 left-1/2 -translate-x-1/2 w-2.5 h-1 bg-cyan-300 rounded" />
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-1 bg-cyan-300 rounded" />
                <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-2.5 bg-cyan-300 rounded" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 w-1 h-2.5 bg-cyan-300 rounded" />
              </div>

              {/* Surface Snap Pill */}
              <div className="mt-3 px-3 py-1 rounded-full bg-slate-950/90 border border-cyan-400/70 text-cyan-300 text-[10px] font-mono font-bold shadow-lg backdrop-blur flex items-center gap-1.5 pointer-events-none">
                <Target className="w-3 h-3 text-cyan-400" />
                <span>Tabletop Normal Aligned [0, 1, 0]</span>
              </div>
            </div>
          )}

          {/* Anchored 3D Desk Reservation Badge on Confirmed Hit Test Surface */}
          {isAnchored && activeSurfacePos && (
            <div
              data-testid="anchored-desk-badge"
              style={{
                transform: `perspective(600px) translate3d(${activeSurfacePos.x * 20}px, ${activeSurfacePos.y * 20}px, 0)`,
              }}
              className="absolute bottom-20 flex flex-col items-center justify-center transition-all duration-300"
            >
              {/* Directional Shadow Plane beneath Anchored Badge */}
              <div
                data-testid="anchored-shadow-plane"
                className="absolute -bottom-8 w-56 h-28 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0)_75%)] pointer-events-none"
              />

              {/* 3D Holographic Marker Card */}
              <div className="relative px-6 py-4 rounded-2xl bg-slate-900/95 border-2 border-emerald-400 shadow-2xl shadow-emerald-950/60 backdrop-blur-xl text-center space-y-2 z-10">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold border border-emerald-500/40">
                  <Anchor className="w-3 h-3 text-emerald-400" />
                  <span>TABLETOP ANCHOR CONFIRMED</span>
                </div>
                <h3 className="text-base font-extrabold text-white">
                  {targetSeatNumber}
                </h3>
                <p className="text-[11px] font-mono text-slate-300">
                  Pos: ({activeSurfacePos.x.toFixed(2)}m,{" "}
                  {activeSurfacePos.y.toFixed(2)}m,{" "}
                  {activeSurfacePos.z.toFixed(2)}m)
                </p>
                <div className="pt-1 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    data-testid="reset-anchor-btn"
                    onClick={handleResetAnchor}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold transition"
                  >
                    Re-anchor
                  </button>
                  <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Surface Anchored
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Top HUD Overlay */}
        <div className="relative z-10 p-4 md:p-6 flex items-center justify-between pointer-events-none">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-700 text-xs font-semibold text-slate-200 backdrop-blur-md">
            <Compass className="w-4 h-4 text-cyan-400" />
            <span>
              AR Heading:{" "}
              <strong className="font-mono text-cyan-300">
                {bearingDeg}° NNE
              </strong>
            </span>
            {!isCompassReliable && (
              <span
                data-testid="ar-fallback-indicator"
                className="ml-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-sans font-medium"
              >
                Horizon Lock
              </span>
            )}
            <span
              data-testid="positioning-mode-indicator"
              className="ml-1 px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-sans font-medium"
            >
              {positioningMode === "WIFI_BEACON_DOMINANT"
                ? "WiFi Beacons"
                : positioningMode === "GPS_DOMINANT"
                  ? "GPS Fix"
                  : "Sensor Fusion"}
            </span>
            {hitTestActive && (
              <span
                data-testid="hit-test-status-indicator"
                className="ml-1 px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-sans font-medium flex items-center gap-1"
              >
                <Target className="w-3 h-3 text-cyan-400" /> Hit-Test Active
              </span>
            )}
          </div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-700 text-xs font-mono text-slate-200 backdrop-blur-md">
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>Floor 2 • West Wing</span>
          </div>
        </div>

        {/* Bottom Turn-by-Turn Instruction Banner & WebXR Hit-Test Controls */}
        <div className="relative z-10 p-4 md:p-6 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent pt-8 space-y-4">
          <div className="p-4 rounded-2xl bg-slate-900/95 border border-slate-800 backdrop-blur-xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold shrink-0">
                {isArrived ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Navigation className="w-5 h-5" />
                )}
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Step {currentStep + 1} of {navPath?.waypoints.length || 3}
                </span>
                <p className="text-sm font-bold text-white">
                  {activeWaypoint?.instruction ||
                    "Follow AR trajectory to reserved workspace"}
                </p>
              </div>
            </div>

            {/* Navigation Stepper & Hit Test Anchor Controls */}
            <div className="flex items-center gap-2 shrink-0">
              {hitTestActive && !isAnchored && (
                <button
                  type="button"
                  data-testid="anchor-desk-badge-btn"
                  onClick={handleAnchorToSurface}
                  className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-600/30 flex items-center gap-1.5 transition"
                >
                  <Anchor className="w-3.5 h-3.5" /> Anchor to Tabletop
                </button>
              )}

              <button
                onClick={handleResetWalk}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                title="Reset simulation"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              {!isArrived ? (
                <button
                  onClick={handleNextStep}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 flex items-center gap-2 transition"
                >
                  <Footprints className="w-4 h-4" /> Advance Step
                </button>
              ) : (
                <Link
                  href="/venues"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-2 transition"
                >
                  <CheckCircle2 className="w-4 h-4" /> Done & Unlocked
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
