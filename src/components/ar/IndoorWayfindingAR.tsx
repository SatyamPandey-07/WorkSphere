"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import {
  Compass,
  MapPin,
  AlertTriangle,
  Sparkles,
  PhoneCall,
  Zap,
  Info,
  X,
  Footprints,
} from "lucide-react";
import {
  getDefaultVenueDestinations,
  createDestinationAnchor,
  updateAnchorPose,
  disposeSpatialAnchor,
  type WayfindingDestination,
  type DestinationCategory,
  type SpatialAnchor,
  type SpatialCalibrationTransform,
  DEFAULT_CALIBRATION,
} from "@/lib/ar/spatialAnchors";

export interface IndoorWayfindingARProps {
  venueId?: string;
  venueName?: string;
  initialDestinationCategory?: DestinationCategory;
  customDestinations?: WayfindingDestination[];
  calibration?: SpatialCalibrationTransform;
  onExit?: () => void;
  className?: string;
}

const CATEGORY_ICONS: Record<DestinationCategory, React.ComponentType<{ className?: string }>> = {
  restroom: Sparkles,
  quiet_booth: PhoneCall,
  power_outlet: Zap,
};

const CATEGORY_LABELS: Record<DestinationCategory, string> = {
  restroom: "Restrooms",
  quiet_booth: "Quiet Booths",
  power_outlet: "Power Outlets",
};

const CATEGORY_COLORS: Record<DestinationCategory, { primary: number; hex: string; bg: string; border: string }> = {
  restroom: { primary: 0x06b6d4, hex: "#06b6d4", bg: "bg-cyan-500/10", border: "border-cyan-500/30" }, // Cyan
  quiet_booth: { primary: 0xa855f7, hex: "#a855f7", bg: "bg-purple-500/10", border: "border-purple-500/30" }, // Purple
  power_outlet: { primary: 0x10b981, hex: "#10b981", bg: "bg-emerald-500/10", border: "border-emerald-500/30" }, // Emerald
};

/**
 * Creates an animated holographic directional arrow group with pulsating rings,
 * chevron direction markers, and destination name placard.
 */
export function createHolographicWayfindingArrow(
  targetPos: { x: number; y: number; z: number },
  destination: WayfindingDestination,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `wayfinding-arrow-${destination.id}`;

  const categoryColor = CATEGORY_COLORS[destination.category] || CATEGORY_COLORS.restroom;
  const colorHex = categoryColor.primary;

  // 1. Neon glowing base beacon cylinder
  const baseGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24);
  const baseMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.set(0, 0.02, 0);
  group.add(baseMesh);

  // 2. Holographic Ground Pulse Ring
  const ringGeo = new THREE.RingGeometry(0.25, 0.35, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.set(0, 0.01, 0);
  ringMesh.name = "pulse-ring";
  group.add(ringMesh);

  // 3. Directional Arrow Cone (Neon 3D Marker)
  const coneGeo = new THREE.ConeGeometry(0.16, 0.38, 16);
  const coneMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.85,
  });
  const coneMesh = new THREE.Mesh(coneGeo, coneMat);
  coneMesh.position.set(0, 0.55, 0);
  coneMesh.rotation.x = Math.PI; // Point downwards toward destination floor position
  coneMesh.name = "floating-cone";
  group.add(coneMesh);

  // 4. Floating destination placard text billboard
  try {
    if (
      typeof document !== "undefined" &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.getContext === "function"
    ) {
      const canvas = document.createElement("canvas");
      // Check if getContext returns a valid 2D context or throws/returns null (e.g. In JSDOM)
      if (typeof (canvas as any)._virtualConsole === "undefined") {
        canvas.width = 512;
        canvas.height = 160;
        let ctx: CanvasRenderingContext2D | null = null;
        try {
          ctx = canvas.getContext("2d");
        } catch {
          ctx = null;
        }
        if (ctx) {
          ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
          ctx.fillRect(8, 8, 496, 144);

          ctx.strokeStyle = categoryColor.hex;
          ctx.lineWidth = 4;
          ctx.strokeRect(8, 8, 496, 144);

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 26px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(destination.name, 256, 60);

          ctx.fillStyle = categoryColor.hex;
          ctx.font = "bold 20px sans-serif";
          ctx.fillText(CATEGORY_LABELS[destination.category].toUpperCase(), 256, 100);

          const texture = new THREE.CanvasTexture(canvas);
          const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.scale.set(0.9, 0.28, 1);
          sprite.position.set(0, 0.95, 0);
          sprite.name = "info-placard";
          group.add(sprite);
        }
      }
    }
  } catch {
    // Canvas sprite fallback for environments without DOM canvas
  }

  group.position.set(targetPos.x, targetPos.y, targetPos.z);
  return group;
}

export default function IndoorWayfindingAR({
  venueId: _venueId = "venue-sf-01",
  venueName = "WorkSphere Innovation Hub",
  initialDestinationCategory = "restroom",
  customDestinations,
  calibration: _calibration = DEFAULT_CALIBRATION,
  onExit,
  className = "",
}: IndoorWayfindingARProps) {
  const [selectedCategory, setSelectedCategory] = useState<DestinationCategory>(
    initialDestinationCategory,
  );
  const [selectedDestinationId, setSelectedDestinationId] = useState<string>("");

  // WebXR support and session states
  const [isWebXRSupported, setIsWebXRSupported] = useState<boolean | null>(null);
  const [isSessionActive, setIsSessionActive] = useState<boolean>(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isCheckingSupport, setIsCheckingSupport] = useState<boolean>(true);
  const [activeDistanceMeters, setActiveDistanceMeters] = useState<number | null>(null);
  const [anchorStatusText, setAnchorStatusText] = useState<string>("Local Anchor Ready");

  // Three.js and WebXR References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sessionRef = useRef<any>(null);
  const referenceSpaceRef = useRef<any>(null);
  const activeAnchorRef = useRef<SpatialAnchor | null>(null);
  const arrowGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Available destinations
  const destinations = React.useMemo(() => {
    return customDestinations && customDestinations.length > 0
      ? customDestinations
      : getDefaultVenueDestinations();
  }, [customDestinations]);

  // Filtered destinations for selected category
  const categoryDestinations = React.useMemo(() => {
    return destinations.filter((d) => d.category === selectedCategory);
  }, [destinations, selectedCategory]);

  // Set default selected destination when category changes
  useEffect(() => {
    const available = categoryDestinations.find((d) => d.isAvailable && d.worldPosition);
    if (available) {
      setSelectedDestinationId(available.id);
    } else if (categoryDestinations.length > 0) {
      setSelectedDestinationId(categoryDestinations[0].id);
    } else {
      setSelectedDestinationId("");
    }
  }, [selectedCategory, categoryDestinations]);

  const activeDestination = React.useMemo(() => {
    return destinations.find((d) => d.id === selectedDestinationId) || null;
  }, [destinations, selectedDestinationId]);

  // Check WebXR Device API availability safely without SSR issues
  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      setIsWebXRSupported(false);
      setIsCheckingSupport(false);
      return;
    }

    if (!("xr" in navigator) || !(navigator as any).xr) {
      setIsWebXRSupported(false);
      setIsCheckingSupport(false);
      return;
    }

    try {
      (navigator as any).xr
        .isSessionSupported("immersive-ar")
        .then((supported: boolean) => {
          setIsWebXRSupported(supported);
          setIsCheckingSupport(false);
        })
        .catch(() => {
          setIsWebXRSupported(false);
          setIsCheckingSupport(false);
        });
    } catch {
      setIsWebXRSupported(false);
      setIsCheckingSupport(false);
    }
  }, []);

  // Update scene arrow marker when active destination or anchor changes
  const updateActiveMarker = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove existing arrow group
    if (arrowGroupRef.current) {
      scene.remove(arrowGroupRef.current);
      arrowGroupRef.current = null;
    }

    if (!activeDestination || !activeDestination.worldPosition) {
      return;
    }

    const anchorPos = activeAnchorRef.current?.position || activeDestination.worldPosition;
    const arrowGroup = createHolographicWayfindingArrow(anchorPos, activeDestination);
    scene.add(arrowGroup);
    arrowGroupRef.current = arrowGroup;
  }, [activeDestination]);

  useEffect(() => {
    updateActiveMarker();
  }, [updateActiveMarker]);

  // Launch WebXR session upon explicit user gesture
  const startARSession = async () => {
    if (typeof navigator === "undefined" || !("xr" in navigator) || !(navigator as any).xr) {
      setSessionError("WebXR is not supported on this device or browser.");
      return;
    }

    if (isSessionActive || sessionRef.current) {
      return; // Prevent duplicate session initialization
    }

    setSessionError(null);

    try {
      // Required and optional features per specification
      const sessionOptions: any = {
        requiredFeatures: ["local"],
        optionalFeatures: ["hit-test", "anchors", "dom-overlay"],
      };

      const session = await (navigator as any).xr.requestSession("immersive-ar", sessionOptions);
      sessionRef.current = session;
      setIsSessionActive(true);

      // Handle session end event
      session.addEventListener("end", () => {
        handleSessionEnd();
      });

      // Obtain reference space (try local-floor first, then local)
      let refSpace: any = null;
      try {
        refSpace = await session.requestReferenceSpace("local-floor");
      } catch {
        refSpace = await session.requestReferenceSpace("local");
      }
      referenceSpaceRef.current = refSpace;

      // Initialize WebGL context and Three.js XR binding
      const canvas = canvasRef.current;
      if (canvas) {
        let renderer = rendererRef.current;
        if (!renderer) {
          renderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            antialias: true,
          });
          renderer.setSize(window.innerWidth, window.innerHeight);
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          rendererRef.current = renderer;
        }

        if (renderer.xr) {
          renderer.xr.enabled = true;
          await renderer.xr.setSession(session);
        }

        // Establish spatial anchor for the current destination
        if (activeDestination && activeDestination.worldPosition) {
          try {
            const anchor = await createDestinationAnchor(session, refSpace, activeDestination);
            activeAnchorRef.current = anchor;
            setAnchorStatusText(
              anchor.trackingMode === "persistent-webxr"
                ? "Persistent Anchor Active"
                : "Local Reference Space Active",
            );
          } catch (anchorErr) {
            console.warn("[IndoorWayfindingAR] Spatial anchor setup note:", anchorErr);
          }
        }

        // Start render loop
        const onXRFrame = (time: number, frame: any) => {
          if (!sessionRef.current) return;

          // Pulse animation on the arrow ring and cone
          if (arrowGroupRef.current) {
            const pulseRing = arrowGroupRef.current.getObjectByName("pulse-ring");
            if (pulseRing) {
              const scale = 1 + 0.15 * Math.sin(time * 0.004);
              pulseRing.scale.set(scale, scale, 1);
            }
            const cone = arrowGroupRef.current.getObjectByName("floating-cone");
            if (cone) {
              cone.position.y = 0.55 + 0.05 * Math.sin(time * 0.003);
            }
          }

          // Update spatial anchor if native frame pose available
          if (activeAnchorRef.current && frame && referenceSpaceRef.current) {
            activeAnchorRef.current = updateAnchorPose(
              activeAnchorRef.current,
              frame,
              referenceSpaceRef.current,
            );
          }

          // Compute distance from camera to active destination
          if (cameraRef.current && activeDestination?.worldPosition) {
            const camPos = cameraRef.current.position;
            const targetPos = activeAnchorRef.current?.position || activeDestination.worldPosition;
            const dx = targetPos.x - camPos.x;
            const dy = targetPos.y - camPos.y;
            const dz = targetPos.z - camPos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            setActiveDistanceMeters(Math.round(dist * 10) / 10);
          }

          if (sceneRef.current && cameraRef.current && rendererRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
          }
        };

        if (typeof renderer.setAnimationLoop === "function") {
          renderer.setAnimationLoop(onXRFrame);
        }
      }
    } catch (err: any) {
      console.error("[IndoorWayfindingAR] Session initialization failure:", err);
      setSessionError(err?.message || "Failed to start WebXR immersive-ar session.");
      handleSessionEnd();
    }
  };

  // Exit AR session and cleanup all resources
  const handleSessionEnd = useCallback(() => {
    setIsSessionActive(false);

    // Stop Three.js XR animation loop
    if (rendererRef.current && typeof rendererRef.current.setAnimationLoop === "function") {
      rendererRef.current.setAnimationLoop(null);
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Clean up active session
    if (sessionRef.current) {
      try {
        sessionRef.current.end();
      } catch {
        // Already ended
      }
      sessionRef.current = null;
    }

    // Reset reference space & active anchor
    referenceSpaceRef.current = null;
    if (activeAnchorRef.current) {
      disposeSpatialAnchor(activeAnchorRef.current);
      activeAnchorRef.current = null;
    }

    setActiveDistanceMeters(null);
  }, []);

  // Initialize Three.js scene and viewport resize listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Ambient and directional lighting for neon materials
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(0, 5, 2);
    scene.add(dirLight);

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      50,
    );
    camera.position.set(0, 1.6, 0);
    cameraRef.current = camera;

    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      handleSessionEnd();
      if (rendererRef.current) {
        try {
          rendererRef.current.dispose();
        } catch {
          // Dispose safe
        }
      }
    };
  }, [handleSessionEnd]);

  // When active destination changes during an active session, re-anchor
  useEffect(() => {
    if (isSessionActive && sessionRef.current && activeDestination?.worldPosition) {
      createDestinationAnchor(
        sessionRef.current,
        referenceSpaceRef.current,
        activeDestination,
      ).then((anchor) => {
        activeAnchorRef.current = anchor;
        updateActiveMarker();
      });
    }
  }, [isSessionActive, activeDestination, updateActiveMarker]);

  const CategoryIcon = CATEGORY_ICONS[selectedCategory] || Sparkles;

  return (
    <div
      data-testid="indoor-wayfinding-ar-container"
      className={`relative w-full h-full min-h-[500px] flex flex-col bg-slate-950 text-white overflow-hidden select-none ${className}`}
    >
      {/* Three.js / WebXR Canvas */}
      <canvas
        ref={canvasRef}
        data-testid="indoor-wayfinding-ar-canvas"
        className={`absolute inset-0 w-full h-full z-0 ${
          isSessionActive ? "block" : "hidden pointer-events-none"
        }`}
      />

      {/* Top Header HUD */}
      <div className="relative z-10 flex items-center justify-between p-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
            <Compass className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              Indoor AR Wayfinding
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-normal">
                WebXR
              </span>
            </h1>
            <p className="text-xs text-slate-400">{venueName}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {isSessionActive && (
            <button
              onClick={handleSessionEnd}
              data-testid="exit-ar-button"
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 transition-colors flex items-center gap-1.5"
            >
              <X className="w-4 h-4" />
              Exit AR
            </button>
          )}

          {onExit && !isSessionActive && (
            <button
              onClick={onExit}
              data-testid="close-ar-view-button"
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Session Active HUD Overlay */}
      {isSessionActive && (
        <div
          data-testid="ar-active-hud"
          className="relative z-10 flex-1 flex flex-col justify-between p-4 pointer-events-none"
        >
          {/* Top telemetry card */}
          <div className="self-center flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur-md text-xs text-slate-200">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <span>Tracking: {anchorStatusText}</span>
            {activeDistanceMeters !== null && (
              <span className="font-semibold text-emerald-400">
                • {activeDistanceMeters}m away
              </span>
            )}
          </div>

          {/* Bottom active destination indicator */}
          <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-4 max-w-md mx-auto w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-lg border ${
                    CATEGORY_COLORS[selectedCategory].bg
                  } ${CATEGORY_COLORS[selectedCategory].border}`}
                >
                  <CategoryIcon className="w-5 h-5 text-slate-100" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    Navigating To
                  </div>
                  <div className="text-sm font-bold text-white">
                    {activeDestination?.name || "Target Destination"}
                  </div>
                </div>
              </div>

              {activeDistanceMeters !== null && (
                <div className="text-right">
                  <span className="text-lg font-bold text-emerald-400">
                    {activeDistanceMeters}
                  </span>
                  <span className="text-xs text-slate-400 ml-1">meters</span>
                </div>
              )}
            </div>

            {/* Quick destination switcher inside AR */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
              {(["restroom", "quiet_booth", "power_outlet"] as DestinationCategory[]).map(
                (cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    data-testid={`ar-hud-switch-${cat}`}
                    className={`flex-1 py-1 px-2 text-xs font-medium rounded-lg border text-center transition-colors ${
                      selectedCategory === cat
                        ? "bg-slate-700/80 border-slate-500 text-white"
                        : "bg-slate-800/40 border-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pre-Session Setup & Category Selection View */}
      {!isSessionActive && (
        <div className="relative z-10 flex-1 p-6 flex flex-col justify-between max-w-2xl mx-auto w-full overflow-y-auto">
          <div className="space-y-6">
            {/* Category Selector Tabs */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Select Destination Category
              </label>
              <div
                role="radiogroup"
                aria-label="Destination Categories"
                className="grid grid-cols-3 gap-2"
              >
                {(["restroom", "quiet_booth", "power_outlet"] as DestinationCategory[]).map(
                  (cat) => {
                    const Icon = CATEGORY_ICONS[cat];
                    const isSelected = selectedCategory === cat;
                    const colors = CATEGORY_COLORS[cat];
                    return (
                      <button
                        key={cat}
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setSelectedCategory(cat)}
                        data-testid={`category-tab-${cat}`}
                        className={`flex flex-col items-center p-3 rounded-xl border text-center transition-all ${
                          isSelected
                            ? `${colors.bg} ${colors.border} ring-2 ring-indigo-500/50 text-white shadow-lg`
                            : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                        }`}
                      >
                        <Icon className="w-5 h-5 mb-1.5" />
                        <span className="text-xs font-medium">{CATEGORY_LABELS[cat]}</span>
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            {/* Destination Specific Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Available Locations ({categoryDestinations.length})
              </label>
              <div className="space-y-2">
                {categoryDestinations.map((dest) => {
                  const isSelected = dest.id === selectedDestinationId;
                  const hasCoordinates = !!dest.worldPosition;
                  return (
                    <button
                      key={dest.id}
                      onClick={() => hasCoordinates && setSelectedDestinationId(dest.id)}
                      disabled={!hasCoordinates}
                      data-testid={`destination-item-${dest.id}`}
                      className={`w-full flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "bg-slate-800 border-indigo-500/60 ring-1 ring-indigo-500 text-white"
                          : hasCoordinates
                          ? "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700"
                          : "bg-slate-900/20 border-slate-800/40 text-slate-500 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <MapPin
                          className={`w-4 h-4 ${
                            isSelected ? "text-indigo-400" : "text-slate-500"
                          }`}
                        />
                        <div>
                          <div className="text-sm font-medium">{dest.name}</div>
                          {dest.description && (
                            <div className="text-xs text-slate-400">{dest.description}</div>
                          )}
                          {!hasCoordinates && (
                            <div className="text-xs text-amber-400/90 flex items-center gap-1 mt-0.5">
                              <AlertTriangle className="w-3 h-3" />
                              Physical spatial coordinate survey pending
                            </div>
                          )}
                        </div>
                      </div>
                      {hasCoordinates && (
                        <div className="text-xs font-mono text-slate-400">
                          {dest.worldPosition
                            ? `(${dest.worldPosition.x}m, ${dest.worldPosition.z}m)`
                            : ""}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Error / Permission Feedback */}
            {sessionError && (
              <div
                role="alert"
                data-testid="ar-session-error"
                className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
                <div>
                  <div className="font-semibold">AR Session Error</div>
                  <div>{sessionError}</div>
                </div>
              </div>
            )}

            {/* WebXR Capability Detection Banner */}
            {!isCheckingSupport && !isWebXRSupported && (
              <div
                data-testid="unsupported-webxr-notice"
                className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-3"
              >
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
                <div className="space-y-1">
                  <div className="font-semibold">WebXR Immersive AR Not Supported</div>
                  <p className="text-slate-300 leading-relaxed">
                    This browser or mobile operating system does not support the WebXR
                    immersive-ar device specification (e.g., standard iOS Safari or desktop
                    browsers without an attached XR headset).
                  </p>
                  <p className="text-slate-400 text-[11px]">
                    Use Google Chrome for Android or a WebXR Viewer to view live 3D AR anchors.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Action Launch Controls */}
          <div className="pt-6 space-y-3">
            <button
              onClick={startARSession}
              disabled={!isWebXRSupported || !activeDestination?.worldPosition}
              data-testid="launch-ar-session-button"
              className={`w-full py-3.5 px-4 rounded-xl font-semibold text-sm shadow-lg flex items-center justify-center gap-2 transition-all ${
                isWebXRSupported && activeDestination?.worldPosition
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer hover:shadow-indigo-500/25 active:scale-[0.99]"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50"
              }`}
            >
              <Footprints className="w-4 h-4" />
              {isCheckingSupport
                ? "Checking WebXR Support..."
                : isWebXRSupported
                ? `Launch AR Wayfinding (${activeDestination?.name || "Select Destination"})`
                : "AR Session Unavailable"}
            </button>

            <p className="text-center text-[11px] text-slate-500">
              WebXR immersive-ar session with WebGL spatial coordinate anchors.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
