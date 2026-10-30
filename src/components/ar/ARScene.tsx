import React, { useEffect, useRef, createContext, useState } from "react";
import * as THREE from "three";
import { useWebXRLightEstimation } from "@/hooks/useWebXRLightEstimation";
import AerospaceHUDOverlay from "@/components/ar/AerospaceHUDOverlay";

export const ARSceneContext = createContext<THREE.Scene | null>(null);

export interface ARSceneProps {
  session: any; // XRSession
  videoElement?: HTMLVideoElement | null;
  children: React.ReactNode;
  onCameraMove?: (position: { x: number; y: number; z: number }) => void;
  showAerospaceHUD?: boolean;
  heading?: number;
  pitch?: number;
  roll?: number;
  altitude?: number;
  floorLevel?: number;
  callsign?: string;
  className?: string;
}

export function ARScene({
  session,
  videoElement,
  children,
  onCameraMove,
  showAerospaceHUD = true,
  heading,
  pitch,
  roll,
  altitude,
  floorLevel,
  callsign,
  className = "",
}: ARSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [cameraPosition, setCameraPosition] = useState<{
    x: number;
    y: number;
    z: number;
  }>({ x: 0, y: 1.5, z: 0 });

  // Refs for lights to allow updates without re-rendering the whole scene graph
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);

  // Get real-time lighting data from camera/XR
  const lightingData = useWebXRLightEstimation(session, videoElement || null);

  // Initialize Scene, Camera, Renderer, and Lights only once
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // Initialize Scene
    const newScene = new THREE.Scene();
    setScene(newScene);

    // Initialize Camera
    const width = typeof window !== "undefined" ? window.innerWidth : 800;
    const height = typeof window !== "undefined" ? window.innerHeight : 600;
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.01, 20);
    cameraRef.current = camera;

    // Initialize Renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(
      typeof window !== "undefined"
        ? Math.min(window.devicePixelRatio || 1, 2)
        : 1,
    );
    if (renderer.xr) {
      renderer.xr.enabled = true;
    }
    rendererRef.current = renderer;

    // Initialize Lights
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 5, 5);
    newScene.add(dirLight);
    directionalLightRef.current = dirLight;

    const ambLight = new THREE.AmbientLight(0xffffff, 0.5);
    newScene.add(ambLight);
    ambientLightRef.current = ambLight;

    if (renderer.domElement) {
      container.appendChild(renderer.domElement);
    }

    return () => {
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      setScene(null);
    };
  }, []);

  // Bind XR Session and Start Animation Loop
  useEffect(() => {
    if (!containerRef.current || !session || !rendererRef.current || !scene)
      return;

    let isMounted = true;
    const renderer = rendererRef.current;
    const currentScene = scene;
    const camera = cameraRef.current;

    if (renderer.xr) {
      renderer.xr.setReferenceSpaceType?.("local-floor");
      renderer.xr
        .setSession?.(session)
        ?.catch?.((e: any) =>
          console.error("Failed to set XR session on renderer", e),
        );
    }

    const renderLoop = (_time: number, _frame: any) => {
      if (!isMounted) return;

      const xrCamera = renderer.xr?.getCamera?.();
      if (xrCamera && xrCamera.position) {
        const pos = {
          x: xrCamera.position.x || 0,
          y: xrCamera.position.y || 0,
          z: xrCamera.position.z || 0,
        };
        if (isMounted) {
          setCameraPosition(pos);
        }
        if (onCameraMove) {
          onCameraMove(pos);
        }
      }
      if (camera) {
        renderer.render(currentScene, camera);
      }
    };

    renderer.setAnimationLoop?.(renderLoop);

    const onResize = () => {
      if (!camera || !renderer) return;
      if (typeof window !== "undefined") {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix?.();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      isMounted = false;
      window.removeEventListener("resize", onResize);
      renderer.setAnimationLoop?.(null);
    };
  }, [session, scene, onCameraMove]);

  // Update lights based on estimation
  useEffect(() => {
    if (
      directionalLightRef.current &&
      ambientLightRef.current &&
      lightingData
    ) {
      const intensity = Math.max(0.1, Math.min(2.0, lightingData.intensity));

      directionalLightRef.current.intensity = intensity;
      ambientLightRef.current.intensity = intensity * 0.5;

      const temp = lightingData.colorTemperature;
      if (temp < 4000) {
        directionalLightRef.current.color.setHex?.(0xffccaa);
        ambientLightRef.current.color.setHex?.(0xffddbb);
      } else if (temp > 7000) {
        directionalLightRef.current.color.setHex?.(0xaaccff);
        ambientLightRef.current.color.setHex?.(0xbbddff);
      } else {
        directionalLightRef.current.color.setHex?.(0xffffff);
        ambientLightRef.current.color.setHex?.(0xffffff);
      }
    }
  }, [lightingData]);

  return (
    <ARSceneContext.Provider value={scene}>
      <div
        ref={containerRef}
        data-testid="ar-scene-container"
        className={`absolute inset-0 pointer-events-none z-10 ${className}`.trim()}
        aria-label="AR Scene Container"
      />
      {showAerospaceHUD && (
        <AerospaceHUDOverlay
          session={session}
          cameraPosition={cameraPosition}
          heading={heading}
          pitch={pitch}
          roll={roll}
          altitude={altitude}
          floorLevel={floorLevel}
          callsign={callsign}
        />
      )}
      {children}
    </ARSceneContext.Provider>
  );
}

export default ARScene;
