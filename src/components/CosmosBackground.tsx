"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export interface CosmosBackgroundProps {
  enabled?: boolean;
}

interface BatteryStatus extends EventTarget {
  charging: boolean;
  level: number;
}

type BatteryAwareNavigator = Navigator & {
  getBattery?: () => Promise<BatteryStatus>;
};

const nebulaVertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const nebulaFragmentShader = `
uniform float uTime;
uniform vec2 uMouse;
varying vec2 vUv;

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 part = fract(point);
  part = part * part * (3.0 - 2.0 * part);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), part.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), part.x),
    part.y
  );
}

float nebula(vec2 point) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 3; octave++) {
    value += noise(point) * amplitude;
    point *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 point = vUv * vec2(3.1, 2.0) + uMouse * 0.025;
  point += vec2(uTime * 0.003, -uTime * 0.0015);
  float cloud = nebula(point);
  float wisps = noise(point * 1.8 + vec2(4.2, -2.7));
  float density = smoothstep(0.35, 0.76, cloud * 0.72 + wisps * 0.28);
  float core = smoothstep(0.69, 0.91, cloud + wisps * 0.18);

  vec3 voidColor = vec3(0.003, 0.009, 0.018);
  vec3 emerald = vec3(0.006, 0.10, 0.065);
  vec3 aurora = vec3(0.018, 0.25, 0.16);
  vec3 color = mix(voidColor, emerald, density * 0.8);
  color += aurora * core * 0.22;
  gl_FragColor = vec4(color, 1.0);
}
`;

const starVertexShader = `
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;

void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = min(5.0, aSize * uPixelRatio * (150.0 / max(-viewPosition.z, 1.0)));
  vColor = aColor;
}
`;

const starFragmentShader = `
varying vec3 vColor;

void main() {
  float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
  float glow = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
  gl_FragColor = vec4(vColor, glow);
}
`;

export function CosmosBackground({ enabled = true }: CosmosBackgroundProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lowPowerRef = useRef(false);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;
    let disposed = false;
    let frameId = 0;
    let lastFrameTime = 0;

    const batteryAwareNavigator = navigator as BatteryAwareNavigator;
    let battery: BatteryStatus | null = null;
    const updateBatteryMode = () => {
      lowPowerRef.current = Boolean(battery && !battery.charging && battery.level <= 0.2);
    };

    void batteryAwareNavigator
      .getBattery?.()
      .then((status) => {
        if (disposed) return;
        battery = status;
        updateBatteryMode();
        battery.addEventListener("levelchange", updateBatteryMode);
        battery.addEventListener("chargingchange", updateBatteryMode);
      })
      .catch((error: unknown) => {
        console.warn("Unable to read battery status for the cosmos background.", error);
      });

    const hasMatchMedia =
      typeof window !== "undefined" && typeof window.matchMedia === "function";
    const isMobile =
      (typeof window !== "undefined" && window.innerWidth < 768) ||
      (hasMatchMedia && window.matchMedia("(pointer: coarse)").matches);
    const reducedMotion =
      hasMatchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const particleCount = isMobile ? 1100 : 1800;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: false,
        antialias: false,
        powerPreference: isMobile ? "low-power" : "high-performance",
      });
    } catch (error) {
      console.error("Unable to initialize the cosmos background WebGL renderer.", error);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.5));
    renderer.setClearColor(0x030712, 1);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 260);
    camera.position.z = 100;

    const nebulaGeometry = new THREE.PlaneGeometry(240, 140);
    const nebulaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2() },
      },
      vertexShader: nebulaVertexShader,
      fragmentShader: nebulaFragmentShader,
      depthWrite: false,
      depthTest: false,
    });
    const nebula = new THREE.Mesh(nebulaGeometry, nebulaMaterial);
    nebula.position.z = -110;
    scene.add(nebula);

    const starGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const random = (min: number, max: number) => min + Math.random() * (max - min);
    for (let index = 0; index < particleCount; index++) {
      const offset = index * 3;
      positions[offset] = random(-110, 110);
      positions[offset + 1] = random(-62, 62);
      positions[offset + 2] = random(-105, 42);
      const tint = random(0.55, 1);
      colors[offset] = 0.46 * tint;
      colors[offset + 1] = 0.78 * tint;
      colors[offset + 2] = 0.68 * tint;
      sizes[index] = random(1.2, 3.2);
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    starGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: starVertexShader,
      fragmentShader: starFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    const targetMouse = new THREE.Vector2();
    const smoothedMouse = new THREE.Vector2();
    const onPointerMove = (event: PointerEvent) => {
      const width = Math.max(window.innerWidth || 1, 1);
      const height = Math.max(window.innerHeight || 1, 1);
      targetMouse.set(
        (event.clientX / width) * 2 - 1,
        1 - (event.clientY / height) * 2,
      );
    };
    const onPointerLeave = () => targetMouse.set(0, 0);
    const resize = () => {
      const width = Math.max(window.innerWidth || 1, 1);
      const height = Math.max(window.innerHeight || 1, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;
    resizeObserver?.observe(container);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    const onVisibilityChange = () => {
      cancelAnimationFrame(frameId);
      if (!document.hidden) {
        lastFrameTime = 0;
        frameId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    resize();

    const startTime = performance.now();
    const animate = (now: number) => {
      if (document.hidden) return;
      frameId = requestAnimationFrame(animate);
      const currentLowPower = lowPowerRef.current;
      const minimumFrameInterval = currentLowPower ? 1000 / 30 : 1000 / 60;
      if (now - lastFrameTime < minimumFrameInterval) return;
      const delta = Math.min((now - (lastFrameTime || now)) / 1000, 0.05);
      lastFrameTime = now;

      smoothedMouse.lerp(targetMouse, 0.025);
      camera.position.x = reducedMotion ? 0 : smoothedMouse.x * 1.1;
      camera.position.y = reducedMotion ? 0 : smoothedMouse.y * 0.7;
      camera.lookAt(0, 0, -24);
      nebulaMaterial.uniforms.uTime.value = reducedMotion ? 0 : (now - startTime) / 1000;
      nebulaMaterial.uniforms.uMouse.value.copy(smoothedMouse);

      if (!reducedMotion) {
        for (let index = 0; index < particleCount; index++) {
          const offset = index * 3;
          positions[offset + 1] += delta * (0.12 + (index % 7) * 0.012);
          positions[offset + 2] += delta * (0.28 + (index % 5) * 0.04);
          if (positions[offset + 1] > 68) positions[offset + 1] = -68;
          if (positions[offset + 2] > 48) positions[offset + 2] = -108;
        }
        starGeometry.attributes.position.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      battery?.removeEventListener("levelchange", updateBatteryMode);
      battery?.removeEventListener("chargingchange", updateBatteryMode);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      starGeometry.dispose();
      starMaterial.dispose();
      nebulaGeometry.dispose();
      nebulaMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      data-testid="cosmos-background-container"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    />
  );
}

export default CosmosBackground;
