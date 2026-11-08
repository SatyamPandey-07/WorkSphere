# Audio Equalizer — Web Audio Node Graph

> **Source:** `src/components/audio/AudioEqualizer.tsx`  
> **Related:** [`WEBAUDIO_SPATIAL_PANNER_MANUAL.md`](./WEBAUDIO_SPATIAL_PANNER_MANUAL.md)

---

## 1. Audio Node Graph

The WorkSphere equalizer routes audio through a 5-band EQ cascade followed by a dynamics compressor to prevent clipping during multi-peer sessions.

```
AudioBuffer (pink / brown / jazz noise)
        │
MediaStreamAudioSourceNode   ← WebRTC remote peer stream
        │
        ▼
   BiquadFilterNode  (60 Hz — lowshelf)     band 0
        │
   BiquadFilterNode  (250 Hz — peaking, Q=1.4)  band 1
        │
   BiquadFilterNode  (1 kHz — peaking, Q=1.4)   band 2
        │
   BiquadFilterNode  (4 kHz — peaking, Q=1.4)   band 3
        │
   BiquadFilterNode  (12 kHz — highshelf)   band 4
        │
   GainNode (masterGain — volume control, 0–1)
        │
   DynamicsCompressorNode   ← prevents multi-peer clipping
        │
   AnalyserNode (fftSize=64 — for visualisation)
        │
   AudioContext.destination
```

---

## 2. Equalizer Frequency Bands

| Band | Centre frequency | Filter type | Typical use |
|------|-----------------|-------------|-------------|
| 0 | 60 Hz | `lowshelf` | Boost/cut bass rumble |
| 1 | 250 Hz | `peaking` (Q=1.4) | Body / warmth |
| 2 | 1 kHz | `peaking` (Q=1.4) | Presence / voice clarity |
| 3 | 4 kHz | `peaking` (Q=1.4) | Articulation / sibilance |
| 4 | 12 kHz | `highshelf` | Air / brightness |

Gain range: **−20 dB to +20 dB** (clamped in `handleBandGainChange`).

### EQ presets

| Preset | 60Hz | 250Hz | 1kHz | 4kHz | 12kHz |
|--------|------|-------|------|------|-------|
| Flat | 0 | 0 | 0 | 0 | 0 |
| Speech clarity | −2 | −1 | +3 | +2 | 0 |
| Bass boost | +5 | +3 | 0 | 0 | 0 |
| Vocal enhancer | −2 | −1 | +3 | +2 | 0 |
| Treble boost | 0 | 0 | 0 | +3 | +5 |
| Warm | +3 | +2 | +1 | −1 | −2 |

---

## 3. Dynamics Compressor Configuration

A `DynamicsCompressorNode` between `masterGain` and the analyser prevents digital clipping when 5+ participants mix audio simultaneously.

| Parameter | Value | Effect |
|-----------|-------|--------|
| `threshold` | −24 dB | Compression begins at −24 dBFS |
| `knee` | 12 dB | Soft knee for natural-sounding limiting |
| `ratio` | 4:1 | Moderate compression — does not crush dynamics |
| `attack` | 3 ms | Fast enough to catch transients |
| `release` | 250 ms | Smooth release avoids pumping artifacts |

---

## 4. Connecting a WebRTC Peer Stream

To route a remote participant's audio track through the EQ pipeline:

```ts
// After RTCPeerConnection fires ontrack:
function connectPeerStreamToEQ(
  ctx: AudioContext,
  stream: MediaStream,
  eqFilters: BiquadFilterNode[],
) {
  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  gain.gain.value = 1.0; // per-peer volume trim

  // Connect: source → gain → first EQ filter
  source.connect(gain);
  gain.connect(eqFilters[0]);

  // EQ filters are already chained to masterGain → compressor → destination
  return { source, gain };
}

// Usage
peerConnection.ontrack = (event) => {
  if (event.track.kind === "audio") {
    connectPeerStreamToEQ(ctx, event.streams[0], eqFiltersRef.current);
  }
};
```

### Cleanup on peer disconnect

```ts
function disconnectPeerStream(source: MediaStreamAudioSourceNode, gain: GainNode) {
  source.disconnect();
  gain.disconnect();
}
```

---

## 5. Preset Persistence

EQ settings are saved to `localStorage` under two keys:

| Key | Value |
|-----|-------|
| `webrtc_eq_preset` | Preset name (`"flat"`, `"balanced"`, ...) |
| `webrtc_eq_gains` | JSON array of 5 gain values |

On mount, saved settings are restored. Changing any slider sets the preset to `"custom"`.
