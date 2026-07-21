"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

interface ARNavigationProps {
  session: XRSession;
  onEndSession: () => void;
}

export default function ARNavigation({
  session,
  onEndSession,
}: ARNavigationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Setup Three.js scene
    const scene = new THREE.Scene();

    // 2. Setup Camera
    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20,
    );

    // 3. Setup Light
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // 4. Create Wayfinding Marker (Arrow)
    // We'll place a few floating arrows in front of the camera
    const createArrow = (zPos: number) => {
      const geometry = new THREE.ConeGeometry(0.1, 0.3, 32);
      // Rotate to point forward (along negative Z axis)
      geometry.rotateX(Math.PI / 2);

      const material = new THREE.MeshPhongMaterial({
        color: 0x3b82f6, // blue-500
        transparent: true,
        opacity: 0.8,
        shininess: 100,
      });
      const arrow = new THREE.Mesh(geometry, material);
      arrow.position.set(0, 0, zPos);
      return arrow;
    };

    // Add some arrows floating ahead
    scene.add(createArrow(-1.5));
    scene.add(createArrow(-3.0));
    scene.add(createArrow(-4.5));

    // 5. Setup Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // Enable XR
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    // 6. Connect session to renderer
    const setupSession = async () => {
      await renderer.xr.setSession(session);
    };
    setupSession();

    // 7. Render loop
    const animate = () => {
      // Optional: Add floating animation to arrows here if needed
      scene.children.forEach((child) => {
        if (child instanceof THREE.Mesh) {
          // Bobbing effect
          child.position.y = Math.sin(Date.now() * 0.003) * 0.05;
        }
      });
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(animate);

    // 8. Handle Window Resize
    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onWindowResize);

    // Cleanup
    const container = containerRef.current;
    return () => {
      window.removeEventListener("resize", onWindowResize);
      renderer.setAnimationLoop(null);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [session]);

  return (
    <div className="absolute inset-0 z-50">
      <div ref={containerRef} className="w-full h-full" />

      {/* DOM Overlay UI */}
      <div
        id="ar-overlay-root"
        className="absolute bottom-10 left-0 right-0 flex justify-center z-50 pointer-events-none"
      >
        <button
          onClick={onEndSession}
          className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-full font-semibold shadow-lg pointer-events-auto transition-colors"
        >
          End AR Navigation
        </button>
      </div>
    </div>
  );
}
