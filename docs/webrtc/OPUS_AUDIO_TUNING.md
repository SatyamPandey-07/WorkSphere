# Opus Audio Tuning & Adaptive Jitter Buffer Reference

This document provides a technical reference for Opus audio tuning, packet-loss handling, in-band Forward Error Correction (FEC), Packet Loss Concealment (PLC), WebRTC jitter-buffer telemetry, and the adaptive bitrate control logic implemented in WorkSphere's real-time WebRTC mesh.

---

## 1. Overview

WorkSphere's peer-to-peer real-time architecture connects remote professionals across co-working spaces, cafes, and distributed teams using WebRTC audio mesh topologies (`RTCPeerConnection` and PartyKit signaling). In collaborative spatial audio environments, conversational intelligibility and low acoustic latency are critical:

- **Interactive Latency Constraints:** Real-time conversational audio requires an end-to-end latency budget below 150–200 ms to avoid conversational collision and perceived lag.
- **Packet Loss Vulnerability:** Mobile, Wi-Fi, and public co-working networks frequently suffer from bursty packet loss, network jitter, and dynamic bandwidth fluctuations.
- **Role of Audio Tuning:** By combining **Packet Loss Concealment (PLC)**, **in-band Forward Error Correction (FEC)**, receiver **jitter-buffer telemetry**, and client-side **adaptive bitrate scaling**, WorkSphere maintains intelligible speech and low latency without requiring session renegotiation.

---

## 2. Packet Loss Concealment (PLC)

Packet Loss Concealment is a receiver-side synthetic signal reconstruction technique executed by the audio decoder (such as the libopus decoder integrated into WebRTC engines):

- **Mechanism:** When an expected audio packet fails to arrive within the playout deadline, the decoder generates an extrapolation of the missing frame using spectral characteristics, pitch periods, and energy envelopes from preceding decoded audio frames.
- **Audio Continuity:** PLC masks short loss gaps (typically 10–40 ms) by smoothing transitions, attenuating energy progressively across consecutive lost frames to prevent sudden clicks, pops, or silence gaps.
- **PLC vs. FEC:**
  - **PLC** is strictly **zero-bandwidth and receiver-driven**. The sender transmits no additional data; the receiver synthesizes missing waveform samples algorithmically. However, PLC degrades rapidly if multiple consecutive packets are lost (beyond ~40–60 ms, synthesized audio sounds robotic or muddled).
  - **FEC**, in contrast, is **sender-driven and proactive**. The sender transmits redundant recovery data in the network payload, enabling true bit-exact or near-exact acoustic recovery of lost audio.

---

## 3. Opus In-Band Forward Error Correction (FEC)

The Opus audio codec (RFC 6716 / RFC 7587) features a native, in-band Forward Error Correction mode embedded directly within the Low-Bitrate Redundancy (LBRR) layer of its SILK speech mode:

- **How In-Band FEC Works:**
  - When enabled (`useinbandfec=1`), the encoder analyzes packet loss conditions. When encoding packet $N$, the encoder includes a lower-bitrate, lower-complexity representation of frame $N-1$ inside packet $N$'s payload.
  - If packet $N-1$ is dropped in transit but packet $N$ arrives successfully, the receiver extracts the redundant copy of frame $N-1$ from packet $N$ and feeds it to the decoder prior to decoding frame $N$.
- **Latency Advantage over Retransmission (NACK):**
  - Ordinary RTP retransmission (NACK / RTX) requires an RTCP feedback cycle: detection of loss $\rightarrow$ RTCP NACK sent upstream $\rightarrow$ sender packet retransmission $\rightarrow$ receiver arrival. This introduces at least 1–1.5 round-trip times (RTT), which exceeds conversational playout deadlines when RTT is moderate or high.
  - In-band FEC recovers lost data within **one packet duration** (typically 20 ms), avoiding playout stalls.
- **Trade-Offs:**
  - **Bandwidth:** Transmitting redundant LBRR data increases bitstream overhead (often 20%–40% additional audio bitrate for redundant SILK frames).
  - **Intelligibility under Loss:** Speech remains clear under 5%–20% random packet loss where unassisted PCM or non-FEC streams would suffer severe syllable clipping.

---

## 4. Opus SDP Parameters

WebRTC negotiates codec parameters during the Session Description Protocol (SDP) offer/answer exchange via the `a=fmtp` (format parameters) line.

### Key Opus Parameters

| Parameter | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| `useinbandfec=1` | Boolean flag (`0` or `1`) | Informs the remote peer that the receiver can decode in-band FEC data and encourages the sender to generate in-band FEC redundancy when loss is detected. |
| `maxaveragebitrate` | Integer (bps) | Informs the encoder of the maximum average audio bitrate in bits per second (e.g. `24000`, `32000`, `64000`). |
| `stereo=0` | Boolean flag (`0` or `1`) | Declares mono (`0`) or stereo (`1`) decoding capability. For conversational voice, `stereo=0` conserves bandwidth. |
| `usedtx=1` | Boolean flag (`0` or `1`) | Enables Discontinuous Transmission (DTX), reducing packet transmission during silence periods. |
| `cbr=0` | Boolean flag (`0` or `1`) | Specifies Variable Bitrate (`0`, VBR) or Constant Bitrate (`1`, CBR). VBR is standard for Opus voice. |

### Realistic SDP `a=fmtp` Example

```text
m=audio 9 UDP/TLS/RTP/SAVPF 111
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=64000;usedtx=1
```

> **Browser Support Note:** While `useinbandfec=1` is supported by Chromium (Blink), Safari (WebKit), and Firefox (Gecko), the exact internal bitrate threshold at which the encoder decides to generate redundant LBRR frames depends on browser vendor implementations and runtime packet-loss estimates communicated via RTCP Receiver Reports. Setting `useinbandfec=1` permits FEC negotiation; it does not guarantee that the encoder will produce redundant frames at very low bitrates (e.g. below 12–16 kbps).

---

## 5. WebRTC Jitter Buffer and getStats() Metrics

Receivers buffer incoming RTP packets in a jitter buffer to reorder out-of-order arrivals and smooth inter-arrival delay variations before playout. Contributors can inspect receiver telemetry via the standard `RTCRtpReceiver.getStats()` API.

### Core Metrics

#### 1. `jitterBufferDelay`
- **Definition:** The cumulative duration (in seconds) that all audio samples or frames have spent queued inside the receiver's jitter buffer before being emitted for playout.
- **Counter Type:** Monotonically increasing cumulative counter.
- **Calculation of Average Delay:** To calculate the instantaneous or interval average jitter-buffer delay, `jitterBufferDelay` must be divided by `jitterBufferEmittedCount`:
  $$\text{Average Delay (seconds)} = \frac{\Delta \text{jitterBufferDelay}}{\Delta \text{jitterBufferEmittedCount}}$$
- **Significance:** A rising average delay indicates growing network delay variance (jitter) or excessive playout buffering, which increases end-to-end conversational lag.

#### 2. `packetsLost`
- **Definition:** The cumulative count of RTP packets recognized as lost (never received prior to playout deadline).
- **Counter Type:** Cumulative counter across the connection lifetime.
- **Interval Interpretation:** `packetsLost` should **never** be treated as an instantaneous loss percentage. Instead, compute the interval delta between two telemetry samples $t_1$ and $t_2$:
  $$\Delta \text{packetsLost} = \text{packetsLost}(t_2) - \text{packetsLost}(t_1)$$
  $$\Delta \text{packetsReceived} = \text{packetsReceived}(t_2) - \text{packetsReceived}(t_1)$$
  $$\text{Loss Fraction} = \frac{\Delta \text{packetsLost}}{\Delta \text{packetsReceived} + \Delta \text{packetsLost}}$$

### JavaScript getStats() Telemetry Inspection Example

```typescript
/**
 * Inspects inbound WebRTC audio RTP receiver statistics safely.
 */
export async function getInboundAudioMetrics(
  receiver: RTCRtpReceiver
): Promise<{
  lossFraction: number;
  avgJitterBufferDelayMs: number | null;
  jitterMs: number | null;
} | null> {
  if (typeof receiver.getStats !== 'function') {
    return null;
  }

  const stats = await receiver.getStats();
  let inboundStats: {
    packetsReceived?: number;
    packetsLost?: number;
    jitter?: number;
    jitterBufferDelay?: number;
    jitterBufferEmittedCount?: number;
  } | null = null;

  stats.forEach((report) => {
    if (
      report.type === 'inbound-rtp' &&
      (report.kind === 'audio' || report.mediaType === 'audio')
    ) {
      inboundStats = report;
    }
  });

  if (!inboundStats) {
    return null;
  }

  const {
    packetsReceived = 0,
    packetsLost = 0,
    jitter,
    jitterBufferDelay,
    jitterBufferEmittedCount,
  } = inboundStats;

  // Cumulative loss ratio calculation
  const total = packetsReceived + packetsLost;
  const lossFraction = total > 0 ? packetsLost / total : 0;

  // Calculate average jitter buffer delay if counter is available
  let avgJitterBufferDelayMs: number | null = null;
  if (
    typeof jitterBufferDelay === 'number' &&
    typeof jitterBufferEmittedCount === 'number' &&
    jitterBufferEmittedCount > 0
  ) {
    avgJitterBufferDelayMs = (jitterBufferDelay / jitterBufferEmittedCount) * 1000;
  }

  const jitterMs = typeof jitter === 'number' ? jitter * 1000 : null;

  return {
    lossFraction,
    avgJitterBufferDelayMs,
    jitterMs,
  };
}
```

---

## 6. WorkSphere Adaptive Bitrate Step Ladder

WorkSphere implements active client-side audio bitrate adaptation in [`src/lib/realtime/webrtc/meshConnection.ts`](../../src/lib/realtime/webrtc/meshConnection.ts).

### Verified Bitrate Constants

| Constant | Value | Description |
| :--- | :--- | :--- |
| `MIN_AUDIO_BITRATE_BPS` | `16_000` (16 kbps) | Emergency throttle ceiling applied during severe network congestion or high packet loss. |
| `THROTTLED_AUDIO_BITRATE_BPS` | `24_000` (24 kbps) | Intermediate degraded tier applied during elevated loss or as a stepping stone during recovery. |
| `MAX_AUDIO_BITRATE_BPS` | `64_000` (64 kbps) | Full-fidelity voice ceiling used under healthy network conditions. |
| `SLIDING_WINDOW_MS` | `5_000` (5 seconds) | Measurement window for computing delta packet loss and average RTT. |

### Adaptation Decision Ladder (`selectTargetAudioBitrateBps`)

Network health is determined over a sliding window (`SLIDING_WINDOW_MS = 5000` ms) using RTCP feedback metrics (`remote-inbound-rtp` packets lost and `roundTripTime`):

$$\text{Loss Fraction} = \frac{\Delta \text{packetsLost}}{\Delta \text{packetsSent} + \Delta \text{packetsLost}}$$

| State / Trigger Condition | Target Bitrate | Action / Reason String |
| :--- | :---: | :--- |
| **Severe Loss:** `lossFraction > 0.15` (>15% loss) | **16 kbps** (`16_000` bps) | Drops immediately to `MIN_AUDIO_BITRATE_BPS`. Reason: `high_packet_loss (<pct>%)`. |
| **Elevated Loss:** `lossFraction > 0.05` (>5% loss) | **24 kbps** (`24_000` bps) | Drops to `THROTTLED_AUDIO_BITRATE_BPS`. Reason: `elevated_packet_loss (<pct>%)`. |
| **Healthy Link:** `lossFraction < 0.01` (<1% loss) **AND** `rttMs < 80` ms | **24 kbps** or **64 kbps** | **Stepped recovery:**<br/>- If current bitrate $< 24\text{ kbps}$, steps up to **24 kbps**.<br/>- If current bitrate $\ge 24\text{ kbps}$, steps up to **64 kbps** (`MAX_AUDIO_BITRATE_BPS`).<br/>Reason: `healthy_link (loss=<pct>%, rtt=<ms>ms)`. |
| **Hysteresis / Neutral Band:** Any other condition | **Hold Current** | Retains current clamped bitrate. Reason: `hold_current_bitrate`. |

### Execution & Application Mechanism

1. **Measurement (`AdaptiveAudioBitrateController.sampleAndAdapt`):**
   - Polls `pc.getStats()` every sampling cycle.
   - Extracts `outbound-rtp` (audio `packetsSent`) and `remote-inbound-rtp` (`packetsLost`, `roundTripTime`).
   - Prunes sample history older than $2 \times \text{SLIDING\_WINDOW\_MS}$ (10 seconds).
2. **Dynamic Encoding Update (`applyAudioMaxBitrate`):**
   - Locates the active audio `RTCRtpSender` (`track.kind === 'audio'`).
   - Obtains current parameters with `sender.getParameters()`.
   - Modifies `encodings[].maxBitrate` to the bounded target bitrate (`16000`–`64000` bps).
   - Applies parameters seamlessly with `await sender.setParameters(...)`.
   - **Zero Renegotiation:** Modifying `maxBitrate` via `setParameters` does not trigger an ICE renegotiation or SDP offer/answer cycle.
3. **Telemetry Emission:**
   - Emits an `AdaptiveAudioTelemetryEvent` (`type: 'audio:bitrate_changed'`) to notify real-time quality monitors and UI status pills.

---

## 7. Practical Tuning Guidance for Contributors

When diagnosing audio quality issues in WorkSphere deployments, use the following operational guidelines:

### High Packet Loss (>5%)
- **Symptoms:** Choppy speech, clipped word endings, frequent robotic distortion.
- **Verification:** Check if `useinbandfec=1` was negotiated in the SDP. Check if `AdaptiveAudioBitrateController` throttled sender bitrate to 24 kbps or 16 kbps.
- **Remediation:**
  - Verify that the network link is not saturated by high-bitrate video or data channels.
  - Ensure background noise suppression does not discard speech frames under low SNR.

### High Jitter-Buffer Delay (>100 ms average)
- **Symptoms:** Noticeable latency during back-and-forth dialogue; peers talking over each other.
- **Verification:** Inspect $\Delta \text{jitterBufferDelay} / \Delta \text{jitterBufferEmittedCount}$ from `RTCRtpReceiver.getStats()`.
- **Remediation:**
  - High jitter buffers stem from variable network routing or Wi-Fi contention.
  - If RTT exceeds 80 ms, WorkSphere intentionally holds lower bitrates to prevent queuing bufferbloat.

### Unstable Network (Oscillating Bitrate)
- **Symptoms:** Bitrate flips rapidly between 16 kbps and 64 kbps.
- **Root Cause & Guard:**
  - WorkSphere's neutral hysteresis band ($1\% \le \text{loss} \le 5\%$ or $\text{RTT} \ge 80$ ms) prevents rapid oscillation.
  - Stepped recovery requires a clean link ($<1\%$ loss and $<80$ ms RTT) over the full 5-second sliding window before transitioning from 16 kbps $\rightarrow$ 24 kbps $\rightarrow$ 64 kbps.

### Poor Audio Quality with 0% Packet Loss
- **Symptoms:** Muffled speech or low volume despite healthy link metrics.
- **Verification:** Check `maxaveragebitrate`. If clamped to 16 kbps unnecessarily, speech bandwidth is restricted to narrow-band/medium-band. Confirm that `MAX_AUDIO_BITRATE_BPS` (64 kbps) is active when network conditions are clean.

---

## 8. References

- [RFC 6716: Definition of the Opus Audio Codec](https://datatracker.ietf.org/doc/html/rfc6716)
- [RFC 7587: RTP Payload Format for the Opus Speech and Audio Codec](https://datatracker.ietf.org/doc/html/rfc7587)
- [W3C WebRTC 1.0: Real-Time Communication Between Browsers](https://www.w3.org/TR/webrtc/)
- [W3C WebRTC Statistics API (Identifiers for WebRTC's Statistics)](https://www.w3.org/TR/webrtc-stats/)
- [MDN Reference: RTCRtpReceiver.getStats()](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/getStats)
- [MDN Reference: RTCRtpSender.setParameters()](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters)
