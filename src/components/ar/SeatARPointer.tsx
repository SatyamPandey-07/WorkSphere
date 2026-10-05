"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { useWebXR } from "@/hooks/useWebXR";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { normalizeAngle } from "@/lib/geometry/bearing";
import CompassFallback from "./CompassFallback";
import { Eye } from "lucide-react";

export interface SeatARPointerProps {
  /** Target reserved seat information */
  seatNumber?: string;
  seatId?: string;
  venueName?: string;
  /** Spatial target anchor coordinates in local AR metric space */
  targetAnchor?: {
    x: number;
    y: number;
    z: number;
  };
  /** Target seat GPS coordinates (if outdoors/large campus) */
  targetGps?: {
    latitude: number;
    longitude: number;
  };
  onClose?: () => void;
}

/**
 * SeatARPointer (#3956):
 * For supported mobile devices with WebXR camera access, projects a floating
 * 3D directional arrow pointing towards the user's reserved seat anchor in AR space.
 * Gracefully falls back to CompassFallback if WebXR is unsupported or denied.
 */
export function SeatARPointer({
  seatNumber = "1A",
  seatId: _seatId,
  venueName = "WorkSphere Venue",
  targetAnchor = { x: 0, y: 0.8, z: -3 }, // default 3 meters ahead
  targetGps,
  onClose,
}: SeatARPointerProps) {
  const { isSupported, requestSession } = useWebXR();
  const { heading: _heading } = useDeviceOrientation();

  const containerRef = useRef<HTMLDivElement>(null);
  const [_xrSession, setXrSession] = useState<XRSession | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [distanceToSeat, setDistanceToSeat] = useState<number>(3.0);
  const [bearingAngle, setBearingAngle] = useState<number>(0);

  // Fallback to CompassFallback if WebXR is explicitly unsupported
  const isWebXRUnavailable = isSupported === false;

  // Initialize WebXR or Device Orientation projection
  const startARSession = useCallback(async () => {
    try {
      const session = await requestSession("immersive-ar", {
        requiredFeatures: ["local-floor"],
        optionalFeatures: ["hit-test", "anchors", "dom-overlay"],
      });
      if (session) {
        setXrSession(session);
        setSessionActive(true);
      }
    } catch (err) {
      console.warn(
        "[SeatARPointer] WebXR session request rejected or unsupported:",
        err,
      );
      // Let user use camera or compass fallback
    }
  }, [requestSession]);

  // Set up Three.js 3D Arrow scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.01, 20);
    camera.position.set(0, 1.2, 0); // user eye level

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
    const coneGeometry = new THREE.ConeGeometry(0.12, 0.35, 32);
    const arrowMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.2,
    });
    const cone = new THREE.Mesh(coneGeometry, arrowMaterial);
    cone.position.set(0, 0.4, 0);

    // Arrow Shaft Cylinder
    const shaftGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 16);
    const shaft = new THREE.Mesh(shaftGeometry, arrowMaterial);
    shaft.position.set(0, 0.15, 0);

    // Pulsing target locator ring on floor
    const ringGeometry = new THREE.RingGeometry(0.2, 0.25, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0, 0);

    arrowGroup.add(cone);
    arrowGroup.add(shaft);
    arrowGroup.add(ring);
    scene.add(arrowGroup);

    // Floating Target Seat Anchor Marker
    const targetVector = new THREE.Vector3(
      targetAnchor.x,
      targetAnchor.y,
      targetAnchor.z,
    );

    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      const elapsedTime = clock.getElapsedTime();

      // Floating bobbing effect
      arrowGroup.position.y = 1.0 + Math.sin(elapsedTime * 2.5) * 0.08;

      // Compute heading transform matrix towards seat anchor
      const currentCameraPos = camera.position;
      const dirToTarget = new THREE.Vector3().subVectors(
        targetVector,
        currentCameraPos,
      );
      const distance = dirToTarget.length();
      setDistanceToSeat(Math.round(distance * 10) / 10);

      // Compute normalized bearing angle
      const rad = Math.atan2(dirToTarget.x, -dirToTarget.z);
      const deg = normalizeAngle((rad * 180) / Math.PI);
      setBearingAngle(Math.round(deg));

      // Orient arrow towards target anchor
      arrowGroup.position.set(0, 0.8, -1.2); // projected 1.2m directly in front of camera view
      arrowGroup.lookAt(targetVector.x, arrowGroup.position.y, targetVector.z);
      // Pitch down slightly to guide user eyes towards floor
      arrowGroup.rotateX(Math.PI / 6);

      // Pulse ring opacity and scale
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
      coneGeometry.dispose();
      shaftGeometry.dispose();
      ringGeometry.dispose();
      arrowMaterial.dispose();
      ringMaterial.dispose();
    };
  }, [targetAnchor]);

  if (isWebXRUnavailable) {
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center p-4">
        <CompassFallback
          destinationLat={targetGps?.latitude}
          destinationLng={targetGps?.longitude}
          destinationName={`Seat ${seatNumber} at ${venueName}`}
          onRetryAR={startARSession}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[500px] overflow-hidden rounded-2xl bg-slate-950">
      {/* 3D WebXR Camera View Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* AR HUD Overlay */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/60 px-3.5 py-2 rounded-xl text-white shadow-lg pointer-events-auto">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold text-slate-200">
              Seat Anchor: {seatNumber}
            </span>
          </div>
          <p className="text-[11px] text-blue-400 font-medium mt-0.5">
            {distanceToSeat}m away • Bearing {bearingAngle}° • Follow 3D Arrow
          </p>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-700 text-slate-300 hover:text-white pointer-events-auto transition"
          >
            ✕
          </button>
        )}
      </div>

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
