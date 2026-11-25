/**
 * @file WebRTCJitterBuffer.test.ts
 * @description Unit test suite for WebRTC adaptive jitter buffer and packet loss concealment (PLC).
 */

import {
  RtpAudioPacket,
  SequenceMath,
  WebRTCJitterBuffer
} from '../../core/webrtc/WebRTCJitterBuffer';

describe('WebRTCJitterBuffer Test Suite', () => {
  describe('SequenceMath (16-bit Rollover Arithmetic)', () => {
    it('correctly compares sequence numbers with 16-bit rollover', () => {
      expect(SequenceMath.isAfter(10, 5)).toBe(true);
      expect(SequenceMath.isAfter(5, 10)).toBe(false);

      // Rollover boundary: 0 is after 65535
      expect(SequenceMath.isAfter(0, 65535)).toBe(true);
      expect(SequenceMath.isAfter(1, 65535)).toBe(true);
      expect(SequenceMath.isAfter(65535, 0)).toBe(false);
    });

    it('calculates sequence differences across rollover boundary', () => {
      expect(SequenceMath.diff(10, 5)).toBe(5);
      expect(SequenceMath.diff(0, 65535)).toBe(1);
      expect(SequenceMath.diff(65535, 0)).toBe(-1);
    });

    it('advances to next sequence number modulo 65536', () => {
      expect(SequenceMath.next(100)).toBe(101);
      expect(SequenceMath.next(65535)).toBe(0);
    });
  });

  describe('Packet Ingestion & Reordering', () => {
    let jb: WebRTCJitterBuffer;

    beforeEach(() => {
      jb = new WebRTCJitterBuffer({
        sampleRate: 16000,
        frameDurationMs: 20
      });
    });

    function makePacket(seq: number, timestamp: number, arrival: number): RtpAudioPacket {
      const payload = new Float32Array(320); // 16kHz * 20ms = 320 samples
      payload.fill(0.5);
      return {
        sequenceNumber: seq,
        timestamp,
        arrivalTimestamp: arrival,
        payload
      };
    }

    it('reorders out-of-order packets and plays them in correct sequence', () => {
      // Arriving in scrambled order: seq 101, then 100, then 102
      jb.pushPacket(makePacket(101, 16320, 25));
      jb.pushPacket(makePacket(100, 16000, 20));
      jb.pushPacket(makePacket(102, 16640, 30));

      const frame1 = jb.popFrame();
      expect(frame1.sequenceNumber).toBe(100);
      expect(frame1.concealed).toBe(false);

      const frame2 = jb.popFrame();
      expect(frame2.sequenceNumber).toBe(101);
      expect(frame2.concealed).toBe(false);

      const frame3 = jb.popFrame();
      expect(frame3.sequenceNumber).toBe(102);
      expect(frame3.concealed).toBe(false);
    });

    it('discards duplicate packets and late arriving packets', () => {
      jb.pushPacket(makePacket(10, 1000, 10));
      // Duplicate push
      expect(jb.pushPacket(makePacket(10, 1000, 12))).toBe(false);

      // Pop frame 10
      const frame = jb.popFrame();
      expect(frame.sequenceNumber).toBe(10);

      // Now packet 9 arrives late (after 10 has already been popped)
      expect(jb.pushPacket(makePacket(9, 680, 25))).toBe(false);

      const stats = jb.getStats();
      expect(stats.packetsDuplicates).toBe(1);
      expect(stats.packetsDroppedLate).toBe(1);
    });
  });

  describe('Packet Loss Concealment (PLC)', () => {
    let jb: WebRTCJitterBuffer;

    beforeEach(() => {
      jb = new WebRTCJitterBuffer({
        sampleRate: 16000,
        frameDurationMs: 20,
        plcDecayFactor: 0.8
      });
    });

    function makeSinePacket(seq: number, val: number): RtpAudioPacket {
      const payload = new Float32Array(320);
      payload.fill(val);
      return {
        sequenceNumber: seq,
        timestamp: seq * 320,
        arrivalTimestamp: seq * 20,
        payload
      };
    }

    it('synthesizes concealed frames with energy attenuation when packets are lost', () => {
      jb.pushPacket(makeSinePacket(1, 1.0));
      // Packet 2 is lost!
      jb.pushPacket(makeSinePacket(3, 1.0));

      const frame1 = jb.popFrame(); // seq 1: real packet
      expect(frame1.sequenceNumber).toBe(1);
      expect(frame1.concealed).toBe(false);
      expect(frame1.audio[0]).toBe(1.0);

      const frame2 = jb.popFrame(); // seq 2: missing! Concealed
      expect(frame2.sequenceNumber).toBe(2);
      expect(frame2.concealed).toBe(true);
      // Attenuation by 0.8^1 = 0.8
      expect(frame2.audio[0]).toBeCloseTo(0.8, 3);

      const frame3 = jb.popFrame(); // seq 3: real packet arrives, recovered with crossfade
      expect(frame3.sequenceNumber).toBe(3);
      expect(frame3.concealed).toBe(false);

      const stats = jb.getStats();
      expect(stats.framesConcealed).toBe(1);
      expect(stats.packetLossRate).toBeCloseTo(33.33, 1);
    });

    it('decays to complete silence after prolonged packet loss burst', () => {
      jb.pushPacket(makeSinePacket(10, 0.9));

      jb.popFrame(); // frame 10 (real)

      // Pop 7 consecutive missing frames (11, 12, 13, 14, 15, 16, 17)
      for (let i = 0; i < 6; i++) {
        const frame = jb.popFrame();
        expect(frame.concealed).toBe(true);
      }

      // 7th lost frame must be complete silence (zeroes)
      const silenceFrame = jb.popFrame();
      expect(silenceFrame.concealed).toBe(true);
      expect(silenceFrame.audio.every((v) => v === 0)).toBe(true);
    });
  });

  describe('RFC 3550 Jitter Estimation & Dynamic Playout Delay', () => {
    it('estimates jitter dynamically from variable transit times', () => {
      const jb = new WebRTCJitterBuffer({
        sampleRate: 16000,
        frameDurationMs: 20
      });

      // Packet 1
      jb.pushPacket({
        sequenceNumber: 1,
        timestamp: 0,
        arrivalTimestamp: 100,
        payload: new Float32Array(320)
      });

      // Packet 2 arrives with high delay (+50ms transit variance)
      jb.pushPacket({
        sequenceNumber: 2,
        timestamp: 320, // +20ms in RTP clock
        arrivalTimestamp: 170, // +70ms in arrival -> D = 50ms
        payload: new Float32Array(320)
      });

      expect(jb.getJitterMs()).toBeGreaterThan(0);
      expect(jb.getTargetDelayMs()).toBeGreaterThanOrEqual(20);
    });
  });
});
