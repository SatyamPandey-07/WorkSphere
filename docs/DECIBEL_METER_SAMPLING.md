# Decibel Meter Real-Time Audio Sampling & Processing Guide

This document provides a comprehensive technical guide to WorkSphere's real-time decibel sampling system. It details the client-side Web Audio API pipeline implemented in [`DecibelMeterModal.tsx`](file:///d:/ECSOC/Worksphere/WorkSphere/src/components/DecibelMeterModal.tsx) and [`useDecibelMeter.ts`](file:///d:/ECSOC/Worksphere/WorkSphere/src/hooks/useDecibelMeter.ts), browser permission handling, RMS decibel calculation formulas, noise classification boundaries, strict privacy safeguards, and step-by-step testing instructions using browser Web Audio mocks.

---

## 1. Overview & System Architecture

WorkSphere allows users to anonymously contribute ambient noise measurements for coworking venues. The sampling process runs for 5 seconds locally in the user's browser, computing a single average decibel value without recording or saving raw audio.

### Web Audio Processing & Data Flow Diagram

```mermaid
flowchart TD
    subgraph Browser ["User Browser (Secure Context HTTPS / localhost)"]
        UserGesture["User Clicks 'Start Measuring'"] --> PermCheck{"Request getUserMedia()"}
        PermCheck -- Granted --> MicStream["MediaStream (Raw Audio Track)"]
        PermCheck -- Denied / Error --> ErrState["Set Error State in UI"]

        MicStream --> SourceNode["MediaStreamAudioSourceNode"]
        SourceNode --> Analyser["AnalyserNode (fftSize = 2048)"]

        Analyser -->|getFloatTimeDomainData| FrameBuffer["Float32Array Buffer (In-Memory)"]
        FrameBuffer --> RMSCalc["RMS Formula Computation"]
        RMSCalc --> DBCvert["Linear RMS to dB Mapping (+100 dB Calibration)"]

        DBCvert --> TickLoop{"Elapsed Time < 5000ms?"}
        TickLoop -- Yes --> UIUpdate["Update Live Feedback (requestAnimationFrame)"]
        TickLoop -- No --> AvgCalc["Calculate 5-Sec Mean Decibel"]
    end

    subgraph Cleanup ["Cleanup & Disposal"]
        AvgCalc --> StopStream["MediaStreamTrack.stop()"]
        StopStream --> CloseCtx["AudioContext.close()"]
        CloseCtx --> GC["Garbage Collect Nodes & Buffers"]
    end

    subgraph Ingestion ["Server Telemetry Ingestion"]
        AvgCalc -->|POST JSON { decibel, duration: 5 }| API["/api/venues/:venueId/noise-metrics"]
    end
```

---

## 2. Microphone Permissions & Web Audio Node Graph

### 2.1 Permission Acquisition & Audio Constraints

Audio capture requires user permission via `navigator.mediaDevices.getUserMedia()`. WorkSphere explicitly disables browser software audio processing (such as echo cancellation, automatic gain control, and noise suppression) to capture unadulterated raw ambient noise levels:

```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: false,
  },
});
```

- **Secure Context Constraint**: Microphone access requires HTTPS or `http://localhost`. In non-secure contexts, `navigator.mediaDevices` is `undefined`.
- **Autoplay Policy Compliance**: `AudioContext` creation is triggered inside an explicit `async` user gesture handler (`handleStart`), satisfying browser autoplay restrictions.

### 2.2 Web Audio Node Graph Pipeline

The node graph connects the microphone input directly to an `AnalyserNode` for time-domain inspection:

```
[ Hardware Microphone ]
         │
         ▼
[ MediaStream (Raw Track) ]
         │
         ▼
[ MediaStreamAudioSourceNode ]
         │
         ▼
[ AnalyserNode (fftSize: 2048) ] ── (getFloatTimeDomainData) ──> [ RMS / dB Calculation ]
         │
         X  (Explicitly NOT connected to AudioContext.destination)
```

> [!IMPORTANT]
> The `AnalyserNode` is **never** connected to `audioContext.destination`. This guarantees zero audio playback/feedback loop through user speakers and prevents any possibility of outbound streaming.

### 2.3 Resource Cleanup Lifecycle

When sampling completes after 5 seconds, or when the user closes the modal / unmounts the component, `stop()` releases all Web Audio resources:

```typescript
const stop = useCallback(() => {
  if (requestRef.current) {
    cancelAnimationFrame(requestRef.current);
    requestRef.current = null;
  }
  if (streamRef.current) {
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }
  if (audioContextRef.current) {
    audioContextRef.current.close().catch(() => {});
    audioContextRef.current = null;
  }
  sourceRef.current = null;
  analyserRef.current = null;
  setIsMeasuring(false);
}, []);
```

---

## 3. Mathematical Formulas & Noise Classification

### 3.1 Root Mean Square (RMS) Computation

Time-domain audio frames extracted via `analyser.getFloatTimeDomainData()` contain PCM amplitude values in the range `[-1.0, 1.0]`. The Root Mean Square (RMS) represents the effective signal amplitude across \(N\) samples (where \(N = \text{fftSize} = 2048\)):

\[
\text{RMS} = \sqrt{\frac{1}{N} \sum_{i=0}^{N-1} x_i^2}
\]

```typescript
export function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}
```

### 3.2 Decibel Mapping & Calibration

Decibels relative to Full Scale (\(\text{dBFS}\)) are logarithmic. Because uncalibrated browser microphones return relative amplitude, WorkSphere applies a **+100 dB calibration offset** to map normalized amplitudes into standard Sound Pressure Level (\(\text{dBSPL}\)) approximations:

\[
\text{dB} = \max\left(30, \min\left(120, 20 \log_{10}(\text{RMS}) + 100\right)\right)
\]

```typescript
export function rmsToDecibels(rms: number): number {
  if (rms <= 0) return 30; // Floor cutoff for silence

  const calibrationOffset = 100;
  const db = 20 * Math.log10(rms) + calibrationOffset;

  return Math.max(30, Math.min(db, 120)); // Clamp to realistic 30-120 dB range
}
```

### 3.3 Noise Classification Thresholds

WorkSphere maps measured decibels into three noise level classifications across client UI displays and database telemetry records:

| Decibel Range   | Environmental Category | UI Indicator Badge       | Description & Workspace Use Case                              |
| :-------------- | :--------------------- | :----------------------- | :------------------------------------------------------------ |
| `< 50 dB`       | **Quiet**              | 🍃 Quiet Focus (Emerald) | Library quiet, whisper zone; ideal for deep focus work        |
| `50 dB – 69 dB` | **Moderate**           | ☕ Ambient Cafe (Amber)  | Background chatter, soft music; suitable for general work     |
| `≥ 70 dB`       | **Loud**               | 🔊 Loud Space (Rose)     | High noise, crowded venue; noise-canceling headphones advised |

---

## 4. Privacy Safeguards & Security Boundaries

WorkSphere enforces strict privacy controls to guarantee microphone data is processed purely in-memory:

1. **Zero Audio Recording**: Raw PCM buffers are processed transiently inside `requestAnimationFrame` iterations. No `MediaRecorder`, `Blob`, or filesystem writes are ever instantiated.
2. **Local Processing Only**: Audio analysis is performed 100% on the client device. Raw audio tracks never leave the browser.
3. **Transient Memory Allocation**: `Float32Array` buffers exist only during frame calculations and are immediately garbage-collected upon function exit.
4. **Minimal Telemetry Payload**: The only data transmitted over the network is the aggregated scalar result (`{ decibel: 48.5, duration: 5, device: "browser" }`).

```
[ Raw Audio Track ] ──> [ In-Memory Analyser ] ──> [ Scalar RMS dB Math ]
                                                           │
                                                           ▼
[ Deleted / GC ] <─── [ Clear Audio Context ] <─── [ Send Scalar dB Number Only ]
```

---

## 5. Testing & Verification with Audio Input Mocks

To test `DecibelMeterModal` and `useDecibelMeter` in Jest without hardware dependencies, mock `navigator.mediaDevices.getUserMedia` and the `AudioContext` web APIs.

### 5.1 Jest Mock Implementation Example

```typescript
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DecibelMeterModal } from "@/components/DecibelMeterModal";

describe("DecibelMeterModal Component", () => {
  const mockGetUserMedia = jest.fn();
  const mockClose = jest.fn().mockResolvedValue(undefined);
  const mockStopTrack = jest.fn();

  beforeAll(() => {
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: { getUserMedia: mockGetUserMedia },
      configurable: true,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const mockStream = {
      getTracks: () => [{ stop: mockStopTrack }],
    };
    mockGetUserMedia.mockResolvedValue(mockStream);

    Object.defineProperty(global, "AudioContext", {
      value: jest.fn().mockImplementation(() => ({
        createMediaStreamSource: jest.fn().mockReturnValue({
          connect: jest.fn(),
        }),
        createAnalyser: jest.fn().mockReturnValue({
          fftSize: 2048,
          getFloatTimeDomainData: jest.fn((arr: Float32Array) => {
            // Fill mock buffer with sine wave audio data (RMS ~0.35 -> ~90 dB)
            for (let i = 0; i < arr.length; i++) {
              arr[i] = 0.5 * Math.sin(i * 0.1);
            }
          }),
        }),
        close: mockClose,
      })),
      writable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("completes 5-second sampling and submits reading", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<DecibelMeterModal venueId="venue-123" onClose={jest.fn()} />);

    // Click start measuring
    fireEvent.click(screen.getByRole("button", { name: /Start Measuring/i }));

    // Fast-forward 5 seconds of sampling
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/venues/venue-123/noise-metrics",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"device":"browser"'),
      })
    );
  });
});
```

---

## 6. Developer Checklist & Best Practices

- **Always Verify HTTPS**: Test microphone access on secure origins to prevent `getUserMedia` undefined errors.
- **Confirm Track Closure**: Always inspect browser tab indicators (red mic icon) to ensure tracks stop immediately when the modal closes.
- **Validate Calibration Bounds**: Keep decibel outputs clamped between 30 dB and 120 dB to handle edge cases gracefully.
