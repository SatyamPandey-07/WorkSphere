# `useBatteryStatus`: Battery Level Tracking & Adaptive Workload Throttling

This document details the architectural design, browser security constraints, TypeScript API types, fallback mechanisms, and 3D rendering throttling strategies for the **`useBatteryStatus`** custom React hook ([`src/hooks/useBatteryStatus.ts`](../../src/hooks/useBatteryStatus.ts)).

---

## 1. Overview & System Architecture

Modern web applications with heavy WebGL 3D floorplans, WebXR spatial tracking, and WebAudio DSP can drain laptop and mobile device batteries rapidly.

`useBatteryStatus` enables WorkSphere to dynamically observe client power conditions:

1. **Adaptive Graphics Quality:** Drops Three.js animation loops from 60 fps to 30 fps or 15 fps when running on low battery unplugged.
2. **Audio Ambience Auto-Pause:** Suspends background noise synthesis and audio visualizer canvas loops when battery levels are critical.
3. **Power Outlet Search Bias:** Automatically elevates coworking venues and desks equipped with AC charging ports when the user's laptop battery reaches panic levels ($\le 10\%$).
4. **Zero-Overhead Event-Driven Updates:** Listens directly to native OS battery manager events without CPU-intensive polling loops.

```mermaid
flowchart TD
    subgraph BrowserAPI["W3C Battery Status API Layer"]
        CheckSupport{"navigator.getBattery in window &<br/>isSecureContext (HTTPS)?"}
        CheckSupport -->|Supported (Chromium/Android)| RequestBattery["navigator.getBattery() Promise"]
        CheckSupport -->|Unsupported (Safari/Firefox)| Fallback["Return INITIAL_STATE<br/>isSupported = false<br/>Default to Full Performance"]

        RequestBattery -->|Resolved| BatteryManager["BatteryManager Event Target"]
        RequestBattery -->|Rejected / Privacy Sandbox| Fallback
    end

    subgraph Listeners["Hardware Event Listeners"]
        BatteryManager --> L1["b.addEventListener('levelchange')"]
        BatteryManager --> L2["b.addEventListener('chargingchange')"]
        BatteryManager --> L3["b.addEventListener('dischargingtimechange')"]
    end

    subgraph StateDerivation["Reactive Threshold Evaluation"]
        L1 --> Eval["Evaluate State<br/>level = b.level<br/>charging = b.charging"]
        L2 --> Eval
        L3 --> Eval

        Eval --> LowCheck{"level &le; 0.20 &&<br/>!charging"}
        LowCheck -->|Yes| SetLow["isLow = true (20% Threshold)"]
        LowCheck -->|No| ClearLow["isLow = false"]

        Eval --> PanicCheck{"level &le; 0.10 &&<br/>!charging"}
        PanicCheck -->|Yes| SetPanic["isPanic = true (10% Threshold)"]
        PanicCheck -->|No| ClearPanic["isPanic = false"]
    end

    subgraph ConsumerActions["Downstream Consumer Workloads"]
        SetLow --> Throttle3D["3D / AR Renderer:<br/>Throttle from 60 fps to 30 fps"]
        SetLow --> AudioThrottle["Audio Equalizer:<br/>Throttle Visualizer from 60 fps to 8 fps"]
        SetPanic --> VenueSearch["Venue Recommendations:<br/>Bias search to AC Power Outlets"]
        ClearLow --> FullSpeed["Restore Full 60 fps Fidelity"]
    end
```

---

## 2. Browser Support & Privacy/Security Constraints

### 2.1 Browser Compatibility Matrix

| Browser Engine                 |     Support Status     | Notes & Privacy Policies                                                                                          |
| :----------------------------- | :--------------------: | :---------------------------------------------------------------------------------------------------------------- |
| **Google Chrome / Chromium**   |    **Full Support**    | Fully supported in desktop and mobile Chrome 38+. Requires HTTPS secure context.                                  |
| **Microsoft Edge**             |    **Full Support**    | Chromium-based Edge supports all `BatteryManager` methods and events.                                             |
| **Android WebViews**           |    **Full Support**    | Supported on Android 5.0+ WebViews and Samsung Internet.                                                          |
| **Mozilla Firefox**            | **Disabled (Privacy)** | Removed in Firefox 52+ to eliminate a high-entropy hardware fingerprinting vector used by cross-site ad trackers. |
| **Apple Safari (iOS & macOS)** |  **Not Implemented**   | Apple WebKit team permanently rejected the API to prevent fingerprinting and user tracking.                       |

### 2.2 Security & Fingerprinting Defense

Because malicious scripts previously used `level` and `dischargingTime` as a composite fingerprinting vector, modern Chromium browsers apply the following mitigations:

- **HTTPS Enforcement:** The API is inaccessible on insecure HTTP origins (`window.isSecureContext === false`).
- **Coarse Level Quantization:** Battery levels are quantized to 1% resolution increments (e.g. `0.85` instead of `0.852341`).
- **Graceful Error Catching:** If a browser or privacy extension blocks access, `useBatteryStatus` catches the rejection without throwing uncaught promise exceptions.

---

## 3. TypeScript API Reference

### 3.1 Return Interface (`BatteryState`)

```typescript
export interface BatteryState {
  /** Battery charge level in range [0.0, 1.0], or null if API is unsupported */
  level: number | null;

  /** True when the device is actively connected to an AC or USB power source */
  charging: boolean;

  /** Estimated remaining seconds until fully discharged, or null if charging / infinite */
  dischargingTime: number | null;

  /** True when battery level is <= 20% (0.20) and device is NOT charging */
  isLow: boolean;

  /** True when battery level is <= 10% (0.10) and device is NOT charging */
  isPanic: boolean;

  /** True if the Battery Status API is available and active in this browser session */
  isSupported: boolean;
}
```

### 3.2 Property Specifications

| Property          | Type             |  Range / Format   | Description                                                                                          |
| :---------------- | :--------------- | :---------------: | :--------------------------------------------------------------------------------------------------- |
| `level`           | `number \| null` |  `0.0` to `1.0`   | Charge percentage ($1.0 = 100\%$, $0.25 = 25\%$). Returns `null` on Firefox and Safari.              |
| `charging`        | `boolean`        |  `true \| false`  | `true` if connected to charger. Discharges return `false`.                                           |
| `dischargingTime` | `number \| null` | Seconds ($\ge 0$) | Estimated time to zero battery. Normalized to `null` if charging or unavailable.                     |
| `isLow`           | `boolean`        |  `true \| false`  | Warning threshold triggered when `level <= 0.2` and `!charging`. Used for graphics throttling.       |
| `isPanic`         | `boolean`        |  `true \| false`  | Critical threshold triggered when `level <= 0.1` and `!charging`. Used for emergency outlet biasing. |
| `isSupported`     | `boolean`        |  `true \| false`  | Feature detection flag indicating whether `navigator.getBattery` is operational.                     |

---

## 4. Hardware Event Listeners & Teardown Lifecycle

The hook binds to three native W3C event listeners on the `BatteryManager` instance:

```typescript
// 1. Fires when battery percentage changes (e.g. 74% -> 73%)
b.addEventListener("levelchange", handleBatteryChange);

// 2. Fires when AC charger is plugged in or unplugged
b.addEventListener("chargingchange", handleBatteryChange);

// 3. Fires when system calculates a new discharge estimate
b.addEventListener("dischargingtimechange", handleBatteryChange);
```

### Teardown & Memory Safety

When the consuming React component unmounts:

1. `isMounted` flag is flipped to `false` to block asynchronous state updates on destroyed components.
2. All three event listeners are explicitly unregistered via `removeEventListener`.

---

## 5. Fallback Behavior for Unsupported Devices

When running on Safari, Firefox, or desktop systems without batteries:

- `isSupported` evaluates to `false`.
- `level` evaluates to `null`.
- `charging` evaluates to `false`.
- `isLow` and `isPanic` evaluate to `false`.

### Consumer Fallback Rule

Consuming components must always guard with `isSupported`:

```typescript
// If battery is unknown or supported and healthy, run at full quality
const shouldThrottle = isSupported && isLow;
```

This ensures users on Safari or desktop computers never receive artificially degraded 3D graphics or throttled framerates.

---

## 6. Code Example: 3D Rendering Framerate Throttling

The following complete TypeScript example demonstrates throttling a Three.js / WebGL animation render loop using `useBatteryStatus`:

```tsx
"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { useBatteryStatus } from "@/hooks/useBatteryStatus";
import { BatteryLow, Zap } from "lucide-react";

export function FloorPlan3DCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isSupported, level, charging, isLow, isPanic } = useBatteryStatus();

  // Determine target framerate based on power state:
  // - Critical battery (< 10% unplugged): 15 fps
  // - Low battery (< 20% unplugged): 30 fps
  // - Charging or Healthy (> 20%): 60 fps
  const targetFps = isPanic ? 15 : isLow ? 30 : 60;
  const frameIntervalMs = 1000 / targetFps;

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Setup Three.js Scene, Camera, and WebGLRenderer
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 15, 25);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isLow,
      powerPreference: "low-power",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isLow ? 1 : Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    // 2. Add Ambient Geometry (Floorplan mesh representation)
    const geometry = new THREE.BoxGeometry(10, 0.5, 10);
    const material = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
    const floorMesh = new THREE.Mesh(geometry, material);
    scene.add(floorMesh);

    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(10, 20, 10);
    scene.add(light);

    // 3. Dynamic Framerate Throttled Render Loop
    let animationFrameId: number;
    let lastRenderTime = performance.now();

    const animate = (currentTime: number) => {
      animationFrameId = requestAnimationFrame(animate);

      const elapsed = currentTime - lastRenderTime;

      // Throttle render execution based on battery interval
      if (elapsed >= frameIntervalMs) {
        lastRenderTime = currentTime - (elapsed % frameIntervalMs);

        // Slowly rotate floor mesh for demonstration
        floorMesh.rotation.y += 0.005;

        renderer.render(scene, camera);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [targetFps, frameIntervalMs, isLow]);

  return (
    <div className="relative w-full h-[500px] rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800">
      <div ref={containerRef} className="w-full h-full" />

      {/* Battery Power Status Pill Overlay */}
      {isSupported && level !== null && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/90 backdrop-blur-md border border-zinc-700 text-xs font-mono">
          {charging ? (
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
          ) : isLow ? (
            <BatteryLow className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          )}
          <span className="text-zinc-200">
            {Math.round(level * 100)}% {charging ? "(Charging)" : ""}
          </span>
          <span className="text-zinc-500 border-l border-zinc-700 pl-2">
            Target: {targetFps} FPS
          </span>
        </div>
      )}
    </div>
  );
}
```
