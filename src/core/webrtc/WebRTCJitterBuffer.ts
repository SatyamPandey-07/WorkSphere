/**
 * @file WebRTCJitterBuffer.ts
 * @description Production-grade adaptive jitter buffer and packet loss concealment (PLC)
 * engine for WebRTC P2P audio streaming and spatial workspace conferences.
 * Implements RFC 3550 inter-arrival jitter estimation, 16-bit sequence rollover detection,
 * energy decay waveform extrapolation, and adaptive playout delay synchronization.
 */

export interface RtpAudioPacket {
  sequenceNumber: number; // 16-bit unsigned (0 - 65535)
  timestamp: number;      // RTP 32-bit timestamp (e.g. 16kHz or 48kHz audio clock)
  arrivalTimestamp: number; // Local receive timestamp (milliseconds)
  payload: Float32Array;  // Audio PCM frame (mono or multichannel float32)
  payloadType?: number;
}

export interface PlayoutFrame {
  sequenceNumber: number;
  timestamp: number;
  audio: Float32Array;
  concealed: boolean;     // True if synthesized via Packet Loss Concealment (PLC)
  timeStretched?: 'accelerated' | 'decelerated' | 'normal';
}

export interface JitterBufferConfig {
  sampleRate: number;        // e.g. 16000 or 48000 Hz
  frameDurationMs: number;   // e.g. 20 ms
  minDelayMs?: number;       // default 20 ms
  maxDelayMs?: number;       // default 200 ms
  plcDecayFactor?: number;   // Energy decay factor per consecutive lost frame (default 0.8)
  accelerationThresholdMs?: number; // Target delay threshold for acceleration
}

export interface JitterBufferStats {
  jitterMs: number;
  targetDelayMs: number;
  currentDepthMs: number;
  packetsReceived: number;
  packetsPopped: number;
  packetsDroppedLate: number;
  packetsDuplicates: number;
  framesConcealed: number;
  packetLossRate: number;
}

/**
 * Utility for 16-bit sequence number arithmetic with wrapping/rollover detection
 */
export class SequenceMath {
  public static readonly MAX_SEQ = 65536;
  public static readonly HALF_SEQ = 32768;

  /**
   * Returns true if seq1 is causally after seq2 considering 16-bit rollover
   */
  public static isAfter(seq1: number, seq2: number): boolean {
    const diff = (seq1 - seq2 + SequenceMath.MAX_SEQ) % SequenceMath.MAX_SEQ;
    return diff > 0 && diff < SequenceMath.HALF_SEQ;
  }

  /**
   * Distance between seq1 and seq2 (seq1 - seq2) with wrapping
   */
  public static diff(seq1: number, seq2: number): number {
    const diff = (seq1 - seq2 + SequenceMath.MAX_SEQ) % SequenceMath.MAX_SEQ;
    return diff >= SequenceMath.HALF_SEQ ? diff - SequenceMath.MAX_SEQ : diff;
  }

  /**
   * Next sequence number in order modulo 65536
   */
  public static next(seq: number): number {
    return (seq + 1) % SequenceMath.MAX_SEQ;
  }
}

/**
 * Adaptive WebRTC Jitter Buffer with Packet Loss Concealment
 */
export class WebRTCJitterBuffer {
  private readonly sampleRate: number;
  private readonly frameDurationMs: number;
  private readonly samplesPerFrame: number;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly plcDecayFactor: number;

  private buffer: Map<number, RtpAudioPacket> = new Map();
  private expectedSequenceNumber: number | null = null;
  private lastPoppedSequenceNumber: number | null = null;

  // RFC 3550 Inter-Arrival Jitter Tracking
  private estimatedJitterMs: number = 0;
  private lastArrivalTimestamp: number = 0;
  private lastRtpTimestamp: number = 0;

  // Adaptive Playout Delay
  private targetDelayMs: number = 40; // initial baseline 40ms
  private recentTransitDelays: number[] = [];

  // Packet Loss Concealment (PLC) State
  private lastValidAudio: Float32Array | null = null;
  private consecutiveLostFrames: number = 0;

  // Metrics
  private totalReceived: number = 0;
  private totalPopped: number = 0;
  private totalDroppedLate: number = 0;
  private totalDuplicates: number = 0;
  private totalConcealed: number = 0;

  constructor(config: JitterBufferConfig) {
    this.sampleRate = config.sampleRate;
    this.frameDurationMs = config.frameDurationMs;
    this.samplesPerFrame = Math.round((config.sampleRate * config.frameDurationMs) / 1000);
    this.minDelayMs = config.minDelayMs ?? 20;
    this.maxDelayMs = config.maxDelayMs ?? 200;
    this.plcDecayFactor = config.plcDecayFactor ?? 0.8;
  }

  /**
   * Pushes an incoming RTP audio packet into the jitter buffer.
   * Discards late packets and duplicates, and updates RFC 3550 jitter metrics.
   */
  public pushPacket(packet: RtpAudioPacket): boolean {
    this.totalReceived++;

    // 1. Check for duplicates or already popped sequence numbers
    if (this.lastPoppedSequenceNumber !== null) {
      if (!SequenceMath.isAfter(packet.sequenceNumber, this.lastPoppedSequenceNumber)) {
        this.totalDroppedLate++;
        return false;
      }
    }

    if (this.buffer.has(packet.sequenceNumber)) {
      this.totalDuplicates++;
      return false;
    }

    // 2. RFC 3550 Jitter Estimation:
    // D(i-1, i) = (R_i - S_i) - (R_{i-1} - S_{i-1})
    // J_i = J_{i-1} + (|D(i-1, i)| - J_{i-1}) / 16
    if (this.lastArrivalTimestamp > 0 && this.lastRtpTimestamp > 0) {
      const rtpTimeMs = (packet.timestamp * 1000) / this.sampleRate;
      const prevRtpTimeMs = (this.lastRtpTimestamp * 1000) / this.sampleRate;

      const transitDiff = (packet.arrivalTimestamp - rtpTimeMs) -
                          (this.lastArrivalTimestamp - prevRtpTimeMs);
      const absD = Math.abs(transitDiff);

      this.estimatedJitterMs += (absD - this.estimatedJitterMs) / 16.0;

      // Maintain recent delays for 95th percentile target sizing
      this.recentTransitDelays.push(absD);
      if (this.recentTransitDelays.length > 50) {
        this.recentTransitDelays.shift();
      }
      this.recalculateTargetDelay();
    }

    this.lastArrivalTimestamp = packet.arrivalTimestamp;
    this.lastRtpTimestamp = packet.timestamp;

    // 3. Store packet in ring buffer
    this.buffer.set(packet.sequenceNumber, packet);

    // Initial sequence anchor or lower reordered arrival before playout begins
    if (
      this.expectedSequenceNumber === null ||
      (this.lastPoppedSequenceNumber === null && SequenceMath.isAfter(this.expectedSequenceNumber, packet.sequenceNumber))
    ) {
      this.expectedSequenceNumber = packet.sequenceNumber;
    }

    return true;
  }

  /**
   * Recalculates dynamic target playout delay based on 95th percentile jitter variance
   */
  private recalculateTargetDelay(): void {
    if (this.recentTransitDelays.length < 5) return;

    const sorted = [...this.recentTransitDelays].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95Jitter = sorted[p95Index] || this.estimatedJitterMs;

    // Target delay = 2 * p95 jitter + safety margin (frame duration)
    const computed = Math.round(p95Jitter * 2.0 + this.frameDurationMs);
    this.targetDelayMs = Math.max(this.minDelayMs, Math.min(this.maxDelayMs, computed));
  }

  /**
   * Current buffered depth in milliseconds
   */
  public getCurrentDepthMs(): number {
    return this.buffer.size * this.frameDurationMs;
  }

  /**
   * Current estimated jitter in milliseconds
   */
  public getJitterMs(): number {
    return Math.round(this.estimatedJitterMs * 100) / 100;
  }

  /**
   * Target playout delay in milliseconds
   */
  public getTargetDelayMs(): number {
    return this.targetDelayMs;
  }

  /**
   * Pops the next sequential audio frame for playout.
   * If the expected packet is present, returns real frame.
   * If missing, performs Packet Loss Concealment (PLC) extrapolation.
   */
  public popFrame(): PlayoutFrame {
    if (this.expectedSequenceNumber === null) {
      return this.synthesizeSilenceFrame(0);
    }

    const currentSeq = this.expectedSequenceNumber;
    const packet = this.buffer.get(currentSeq);

    if (packet) {
      // Packet is available!
      this.buffer.delete(currentSeq);
      this.lastPoppedSequenceNumber = currentSeq;
      this.expectedSequenceNumber = SequenceMath.next(currentSeq);
      this.totalPopped++;

      let outputAudio = packet.payload;

      // If recovering from a packet loss burst, apply smooth cross-fade with previous frame
      if (this.consecutiveLostFrames > 0 && this.lastValidAudio) {
        outputAudio = this.crossfadeOverlap(this.lastValidAudio, packet.payload);
      }

      this.lastValidAudio = new Float32Array(outputAudio);
      this.consecutiveLostFrames = 0;

      // Time stretching check (accelerate if buffer depth is excessively large)
      let timeStretched: 'accelerated' | 'decelerated' | 'normal' = 'normal';
      const depth = this.getCurrentDepthMs();
      if (depth > this.targetDelayMs * 1.5 && outputAudio.length === this.samplesPerFrame) {
        outputAudio = this.timeCompress(outputAudio, 0.9); // speed up by 10%
        timeStretched = 'accelerated';
      }

      return {
        sequenceNumber: currentSeq,
        timestamp: packet.timestamp,
        audio: outputAudio,
        concealed: false,
        timeStretched
      };
    } else {
      // Packet is missing -> Synthesize concealed frame (PLC)
      this.totalConcealed++;
      this.consecutiveLostFrames++;
      this.lastPoppedSequenceNumber = currentSeq;
      this.expectedSequenceNumber = SequenceMath.next(currentSeq);

      const concealedAudio = this.synthesizePlcAudio();

      return {
        sequenceNumber: currentSeq,
        timestamp: 0,
        audio: concealedAudio,
        concealed: true,
        timeStretched: 'normal'
      };
    }
  }

  /**
   * Synthesizes audio using pitch-synchronous energy decay extrapolation
   */
  private synthesizePlcAudio(): Float32Array {
    const out = new Float32Array(this.samplesPerFrame);

    if (!this.lastValidAudio || this.lastValidAudio.length === 0) {
      // Zero silence fallback
      return out;
    }

    // Exponential decay factor based on consecutive lost frames
    const attenuation = Math.pow(this.plcDecayFactor, this.consecutiveLostFrames);

    // After 5 consecutive lost frames, decay to complete silence
    if (this.consecutiveLostFrames > 5) {
      return out;
    }

    const prev = this.lastValidAudio;
    for (let i = 0; i < this.samplesPerFrame; i++) {
      const srcSample = prev[i % prev.length] || 0;
      out[i] = srcSample * attenuation;
    }

    return out;
  }

  /**
   * Smooth Overlap-Add (OLA) cross-fade between concealed audio and newly arrived frame
   */
  private crossfadeOverlap(prevAudio: Float32Array, nextAudio: Float32Array): Float32Array {
    const out = new Float32Array(nextAudio.length);
    const overlapLen = Math.min(Math.round(this.samplesPerFrame * 0.25), prevAudio.length, nextAudio.length);

    for (let i = 0; i < nextAudio.length; i++) {
      if (i < overlapLen) {
        const factor = i / overlapLen; // 0.0 -> 1.0
        out[i] = prevAudio[i % prevAudio.length] * (1 - factor) + nextAudio[i] * factor;
      } else {
        out[i] = nextAudio[i];
      }
    }
    return out;
  }

  /**
   * Lightweight time compression (decimation with linear interpolation)
   */
  private timeCompress(audio: Float32Array, factor: number): Float32Array {
    const targetLen = Math.round(audio.length * factor);
    const compressed = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
      const srcIdx = (i / audio.length) * targetLen;
      const idxFloor = Math.floor(srcIdx);
      const frac = srcIdx - idxFloor;
      const s0 = audio[idxFloor] || 0;
      const s1 = audio[Math.min(audio.length - 1, idxFloor + 1)] || 0;
      compressed[i] = s0 * (1 - frac) + s1 * frac;
    }
    return compressed;
  }

  private synthesizeSilenceFrame(seq: number): PlayoutFrame {
    return {
      sequenceNumber: seq,
      timestamp: 0,
      audio: new Float32Array(this.samplesPerFrame),
      concealed: true,
      timeStretched: 'normal'
    };
  }

  /**
   * Returns comprehensive runtime statistics
   */
  public getStats(): JitterBufferStats {
    const totalFrames = this.totalPopped + this.totalConcealed;
    const lossRate = totalFrames > 0 ? (this.totalConcealed / totalFrames) * 100 : 0;

    return {
      jitterMs: this.getJitterMs(),
      targetDelayMs: this.targetDelayMs,
      currentDepthMs: this.getCurrentDepthMs(),
      packetsReceived: this.totalReceived,
      packetsPopped: this.totalPopped,
      packetsDroppedLate: this.totalDroppedLate,
      packetsDuplicates: this.totalDuplicates,
      framesConcealed: this.totalConcealed,
      packetLossRate: Math.round(lossRate * 100) / 100
    };
  }

  /**
   * Resets buffer state
   */
  public reset(): void {
    this.buffer.clear();
    this.expectedSequenceNumber = null;
    this.lastPoppedSequenceNumber = null;
    this.estimatedJitterMs = 0;
    this.lastArrivalTimestamp = 0;
    this.lastRtpTimestamp = 0;
    this.lastValidAudio = null;
    this.consecutiveLostFrames = 0;
  }
}
