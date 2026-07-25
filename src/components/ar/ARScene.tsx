/* eslint-disable */
import React, { useEffect, useRef, createContext } from "react";
import * as THREE from "three";

export const ARSceneContext = createContext<THREE.Scene | null>(null);

interface ARSceneProps {
  session: any;
  children: React.ReactNode;
  onCameraMove?: (position: { x: number; y: number; z: number }) => void;
}

export function ARScene({ session, children, onCameraMove }: ARSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  if (!sceneRef.current) sceneRef.current = new THREE.Scene();
  if (!rendererRef.current)
    rendererRef.current = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
  if (!cameraRef.current)
    cameraRef.current = new THREE.PerspectiveCamera(70, 1, 0.01, 20);

  const scene = sceneRef.current;
  const renderer = rendererRef.current;
  const camera = cameraRef.current;

  useEffect(() => {
    if (!containerRef.current || !session) return;

    const container = containerRef.current;
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.xr.enabled = true;

    // This links the Three.js XR manager to the native session
    renderer.xr.setReferenceSpaceType("local-floor");
    renderer.xr
      .setSession(session)
      .catch((e) => console.error("Failed to set XR session on renderer", e));

    container.appendChild(renderer.domElement);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    scene.add(light);

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
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      renderer.setAnimationLoop(null);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [session, renderer, scene, camera, onCameraMove]);

  return (
    <ARSceneContext.Provider value={scene}>
      <div
        ref={containerRef}
        className="absolute inset-0 pointer-events-none z-10"
      />
      {children}
    </ARSceneContext.Provider>
  );
}
