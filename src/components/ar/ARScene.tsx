/* eslint-disable */
import React, { useEffect, useRef, createContext, useMemo } from "react";
import * as THREE from "three";
import { useWebXRLightEstimation } from "@/hooks/useWebXRLightEstimation";

export const ARSceneContext = createContext<THREE.Scene | null>(null);

interface ARSceneProps {
  session: any; // XRSession
  videoElement?: HTMLVideoElement | null;
  children: React.ReactNode;
  onCameraMove?: (position: { x: number; y: number; z: number }) => void;
}

export function ARScene({ session, videoElement, children, onCameraMove }: ARSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  
  // Refs for lights to allow updates without re-rendering the whole scene graph
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);

  // Get real-time lighting data from camera/XR
  // We pass the session and optional video element to the hook
  const lightingData = useWebXRLightEstimation(session, videoElement || null);

  // Initialize Scene, Camera, Renderer, and Lights only once
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    
    // Initialize Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Initialize Camera
    const width = window.innerWidth;
    const height = window.innerHeight;
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.01, 20);
    cameraRef.current = camera;

    // Initialize Renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.xr.enabled = true;
    rendererRef.current = renderer;

    // Initialize Lights
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);
    directionalLightRef.current = dirLight;

    const ambLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambLight);
    ambientLightRef.current = ambLight;

    container.appendChild(renderer.domElement);

    return () => {
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Bind XR Session and Start Animation Loop
  useEffect(() => {
    if (!containerRef.current || !session || !rendererRef.current) return;

    const renderer = rendererRef.current;
    const scene = sceneRef.current!;
    const camera = cameraRef.current!;

    // This links the Three.js XR manager to the native session
    renderer.xr.setReferenceSpaceType("local-floor");
    renderer.xr
      .setSession(session)
      .catch((e) => console.error("Failed to set XR session on renderer", e));

    const renderLoop = (_time: number, _frame: any) => {
      const xrCamera = renderer.xr.getCamera();
      if (xrCamera && onCameraMove) {
        // Throttle this slightly in a real app, but for now every frame is fine
        onCameraMove({
          x: xrCamera.position.x,
          y: xrCamera.position.y,
          z: xrCamera.position.z,
        });
      }
      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(renderLoop);

    const onResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      renderer.setAnimationLoop(null);
    };
  }, [session, onCameraMove]);

  // Update lights based on estimation
  useEffect(() => {
    if (directionalLightRef.current && ambientLightRef.current && lightingData) {
      // Adjust intensity
      // Clamp intensity to reasonable values to avoid blowing out the scene
      const intensity = Math.max(0.1, Math.min(2.0, lightingData.intensity));
      
      directionalLightRef.current.intensity = intensity;
      ambientLightRef.current.intensity = intensity * 0.5;

      // Adjust color temperature (simplified conversion)
      const temp = lightingData.colorTemperature;
      if (temp < 4000) {
        // Warm light (e.g., incandescent, sunset)
        directionalLightRef.current.color.setHex(0xffccaa);
        ambientLightRef.current.color.setHex(0xffddbb);
      } else if (temp > 7000) {
        // Cool light (e.g., overcast sky, fluorescent)
        directionalLightRef.current.color.setHex(0xaaccff);
        ambientLightRef.current.color.setHex(0xbbddff);
      } else {
        // Neutral daylight
        directionalLightRef.current.color.setHex(0xffffff);
        ambientLightRef.current.color.setHex(0xffffff);
      }
    }
  }, [lightingData]);

  return (
    <ARSceneContext.Provider value={sceneRef.current}>
      <div
        ref={containerRef}
        className="absolute inset-0 pointer-events-none z-10"
        aria-label="AR Scene Container"
      />
      {children}
    </ARSceneContext.Provider>
  );
}
