# Military Cockpit Avionics Audio Frequencies & Web Audio Synthesis Parameters

## 1. Executive Summary & Auditory Standards

WorkSphere's augmented reality spatial navigation, aerospace heads-up displays (`AerospaceHUDOverlay.tsx`, `CollimatedHUDOverlay.tsx`), and tactical telemetry overlays require precise auditory cues to communicate spatial states to operators.

To prevent auditory confusion and hearing fatigue while complying with aerospace human factor engineering standards (**MIL-STD-1472H** and **MIL-STD-411F** for Aircraft Audio Signals), all synthetic cues are parameterized with exact:

- **Oscillation Frequencies ($f_0$ in Hz)**
- **Harmonic Waveform Topology** (`sine`, `triangle`, `sawtooth`, `square`, or `custom`)
- **Attack, Decay, Sustain, and Release (ADSR) Envelope Timings**
- **Dynamic Gain Headroom Thresholds (dBFS)**

This document provides the mathematical parameters and Web Audio API reference implementations for every tactical acoustic cue in WorkSphere.

---

## 2. Master Acoustic Parameters & Frequency Matrix

| Audio Cue Identifier       | Primary Frequencies ($f_0$)                    | Harmonic Waveform     | Attack ($T_{\text{att}}$) | Decay ($T_{\text{dec}}$) | Sustain ($S_{\text{lvl}}$) | Release ($T_{\text{rel}}$) | Peak Gain (dBFS)  | Acoustic Purpose                            |
| :------------------------- | :--------------------------------------------- | :-------------------- | :------------------------ | :----------------------- | :------------------------- | :------------------------- | :---------------- | :------------------------------------------ |
| **Target Lock Tone**       | `880.0 Hz` ($A_5$)                             | `sine`                | $8\text{ ms}$             | $140\text{ ms}$          | $0.0$                      | $20\text{ ms}$             | $-6.0\text{ dB}$  | Target acquired / Desk coordinate snap      |
| **Master Caution Chime**   | `440.0 Hz` ($A_4$) $\to$ `554.37 Hz` ($C\#_5$) | `triangle`            | $25\text{ ms}$            | $350\text{ ms}$          | $0.0$                      | $80\text{ ms}$             | $-8.0\text{ dB}$  | High noise alert / Booking expiry warning   |
| **RWR Threat Chirp**       | `1760.0 Hz` ($A_6$) / `3520.0 Hz` ($A_7$)      | `square`              | $4\text{ ms}$             | $45\text{ ms}$           | $0.0$                      | $15\text{ ms}$             | $-10.0\text{ dB}$ | Collision proximity / Geofence breach       |
| **Sonic Boom Thump**       | `45.0 Hz` $\to$ `18.0 Hz` (Pitch Sweep)        | `sine` + Noise        | $6\text{ ms}$             | $480\text{ ms}$          | $0.0$                      | $120\text{ ms}$            | $-4.0\text{ dB}$  | Supersonic navigation mode / /afterburner   |
| **Waypoint Alignment**     | `1320.0 Hz` $\to$ `1760.0 Hz` (Arpeggio)       | `sine`                | $12\text{ ms}$            | $90\text{ ms}$           | $0.0$                      | $30\text{ ms}$             | $-9.0\text{ dB}$  | Boresight aligned with forward heading      |
| **Floor Altitude Warning** | `587.33 Hz` ($D_5$) Pulse                      | `sawtooth` (filtered) | $18\text{ ms}$            | $160\text{ ms}$          | $0.2$                      | $50\text{ ms}$             | $-9.5\text{ dB}$  | Proximity to target floor / Elevation alert |
| **Construct Manifest**     | `528.0 Hz` / `792.0 Hz` / `1056.0 Hz`          | Custom Harmonic       | $40\text{ ms}$            | $650\text{ ms}$          | $0.1$                      | $200\text{ ms}$            | $-7.0\text{ dB}$  | Green Lantern hard-light construct spawn    |

---

## 3. ADSR Envelope Curves & Gain Headroom Mathematics

### 3.1 Anti-Click Transient Protection

Sudden step changes in audio amplitude create high-frequency spectral splatter (perceived as audible clicks or pops). All envelope generators must apply a minimum logarithmic or linear attack rise of **$\ge 4.0\text{ ms}$**:

```
Gain
  ▲
1.0 ┼               ┌───┐ (Peak Gain: -6 dBFS = 0.501)
    │              /     \
    │             /       \ (Exponential Decay)
0.2 ┼            /         └──┐ (Sustain Level)
    │           /              \
0.0 ┼──────────┴────────────────┴──────► Time
    0        T_att     T_dec   T_rel
           (8-25ms)  (140ms)   (20ms)
```

### 3.2 Decibels Full Scale (dBFS) to Linear Conversion

In the Web Audio API, `GainNode.gain.value` operates in linear amplitude $[0.0, 1.0]$. The conversion from decibels full scale ($\text{dBFS}$) is:

$$A_{\text{linear}} = 10^{\frac{\text{dBFS}}{20}}$$

- $-4.0\text{ dBFS} \approx 0.6310$
- $-6.0\text{ dBFS} \approx 0.5012$
- $-8.0\text{ dBFS} \approx 0.3981$
- $-12.0\text{ dBFS} \approx 0.2512$

### 3.3 Exponential Envelope Parameter Scheduling

Audio parameters must be scheduled using `AudioParam` timeline methods rather than manual timer updates:

```typescript
// Standard military attack-decay envelope
gainNode.gain.setValueAtTime(0.0001, startTime);
gainNode.gain.exponentialRampToValueAtTime(
  peakLinearGain,
  startTime + attackTime,
);
gainNode.gain.exponentialRampToValueAtTime(
  0.0001,
  startTime + attackTime + decayTime,
);
```

---

## 4. Production Web Audio Synthesis Implementations

### 4.1 Target Lock Acquisition Tone (`880 Hz`)

Fires when a desk or target anchor snaps into the center reticle of `WebXRDeskFinderView.tsx`:

```typescript
export function playTargetLockTone(audioCtx: AudioContext): void {
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  // 880 Hz Concert A5 pure sine wave
  osc.type = "sine";
  osc.frequency.setValueAtTime(880.0, now);

  // -6 dBFS peak headroom = ~0.501 linear
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.501, now + 0.008); // 8ms attack
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.148); // 140ms decay

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + 0.15);
}
```

---

### 4.2 Master Caution Chime (`440 Hz` $\to$ `554.37 Hz` Major Third)

Fires for high ambient decibels or reservation alerts:

```typescript
export function playMasterCautionChime(audioCtx: AudioContext): void {
  const now = audioCtx.currentTime;

  const notes = [440.0, 554.37]; // A4 and C#5 (pleasant major third warning)
  notes.forEach((freq, index) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const startTime = now + index * 0.14; // Staggered by 140ms

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.398, startTime + 0.025); // 25ms attack (-8 dBFS)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.375); // 350ms decay

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(startTime);
    osc.stop(startTime + 0.38);
  });
}
```

---

### 4.3 Sonic Boom Sub-Bass Pressure Wave (`45 Hz` $\to$ `18 Hz`)

Synthesizes the atmospheric shockwave when engaging supersonic transit navigation:

```typescript
export function playSonicBoomTransient(audioCtx: AudioContext): void {
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  // Sub-bass sine oscillator with rapid downward frequency sweep
  osc.type = "sine";
  osc.frequency.setValueAtTime(45.0, now);
  osc.frequency.exponentialRampToValueAtTime(18.0, now + 0.45); // Pitch drop

  // Lowpass filter keeping purely sub-perceptual pressure rumble
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(80.0, now);
  filter.Q.setValueAtTime(3.5, now);

  // Dynamic envelope: -4 dBFS peak (0.631)
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.631, now + 0.006); // 6ms initial shock front
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.486); // 480ms dissipation

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + 0.5);
}
```

---

### 4.4 Radar Warning Receiver (RWR) Pulse Ping (`1760 Hz` / `3520 Hz`)

Tactical high-urgency annunciator:

```typescript
export function playRWRThreatPing(audioCtx: AudioContext): void {
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  // Dual octave square wave for military cockpit penetration
  osc.type = "square";
  osc.frequency.setValueAtTime(1760.0, now);
  osc.frequency.setValueAtTime(3520.0, now + 0.025); // Modulate up at 25ms

  // Tight -10 dBFS gate (0.316)
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.316, now + 0.004); // 4ms attack
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.049); // 45ms decay

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + 0.05);
}
```

---

## 5. Master Output Limiter & Headroom Architecture

To guarantee that simultaneous overlapping chimes never exceed $0\text{ dBFS}$ (causing digital clipping distortion), all cues route through a **Master Safety DynamicsCompressorNode**:

```typescript
export function createMasterAudioBus(
  audioCtx: AudioContext,
): DynamicsCompressorNode {
  const limiter = audioCtx.createDynamicsCompressor();

  // Brickwall limiter configuration
  limiter.threshold.setValueAtTime(-3.0, audioCtx.currentTime); // -3 dBFS threshold
  limiter.knee.setValueAtTime(0.0, audioCtx.currentTime); // Hard knee
  limiter.ratio.setValueAtTime(20.0, audioCtx.currentTime); // 20:1 brickwall compression
  limiter.attack.setValueAtTime(0.002, audioCtx.currentTime); // 2ms fast clamp
  limiter.release.setValueAtTime(0.12, audioCtx.currentTime); // 120ms release

  limiter.connect(audioCtx.destination);
  return limiter;
}
```

---

## 6. Headless Unit Testing & Parameter Assertions

```typescript
describe("playTargetLockTone Web Audio Parameters", () => {
  it("schedules 880Hz oscillation with correct ADSR envelope", () => {
    const mockAudioContext = {
      currentTime: 10.0,
      createOscillator: jest.fn().mockReturnValue({
        type: "sine",
        frequency: { setValueAtTime: jest.fn() },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      }),
      createGain: jest.fn().mockReturnValue({
        gain: {
          setValueAtTime: jest.fn(),
          linearRampToValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
        connect: jest.fn(),
      }),
      destination: {},
    };

    playTargetLockTone(mockAudioContext as unknown as AudioContext);

    const osc = mockAudioContext.createOscillator.mock.results[0].value;
    const gain = mockAudioContext.createGain.mock.results[0].value;

    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(880.0, 10.0);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.501,
      10.008,
    );
    expect(osc.stop).toHaveBeenCalledWith(10.15);
  });
});
```
