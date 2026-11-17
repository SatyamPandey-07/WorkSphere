import { describe, it, expect } from 'vitest';
import {
  StreamingSpatializerWasm,
  distance3D,
  DEFAULT_ACOUSTIC_CONFIG,
} from '../../core/wasm/StreamingSpatializerWasm';

describe('StreamingSpatializerWasm (3D Audio Spatializer)', () => {
  describe('Geometry & Distance Helpers', () => {
    it('computes Euclidean distance in 3D', () => {
      const d = distance3D({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
      expect(d).toBe(5);
    });
  });

  describe('Binaural Spatial Processing', () => {
    const spatializer = new StreamingSpatializerWasm();

    it('balances left and right channels equally for centered audio in front', () => {
      const input = new Float32Array(128).fill(0.5);
      const centerSource = {
        position: { x: 0, y: 0, z: 2 }, // Directly 2 meters ahead
      };

      const out = spatializer.spatialize(input, centerSource);
      expect(out.sampleCount).toBe(128);

      // Left and right channels should have identical amplitude
      const sumLeft = out.leftChannel.reduce((a, b) => a + Math.abs(b), 0);
      const sumRight = out.rightChannel.reduce((a, b) => a + Math.abs(b), 0);

      expect(sumLeft).toBeCloseTo(sumRight, 2);
    });

    it('attenuates right channel when sound source is to the left', () => {
      const input = new Float32Array(128).fill(0.8);
      const leftSource = {
        position: { x: -3, y: 0, z: 1 }, // Strongly to the left
      };

      const out = spatializer.spatialize(input, leftSource);
      const sumLeft = out.leftChannel.reduce((a, b) => a + Math.abs(b), 0);
      const sumRight = out.rightChannel.reduce((a, b) => a + Math.abs(b), 0);

      // Left channel should be significantly louder than right channel due to ILD head shadow
      expect(sumLeft).toBeGreaterThan(sumRight);
    });

    it('attenuates left channel when sound source is to the right', () => {
      const input = new Float32Array(128).fill(0.8);
      const rightSource = {
        position: { x: 3, y: 0, z: 1 }, // Strongly to the right
      };

      const out = spatializer.spatialize(input, rightSource);
      const sumLeft = out.leftChannel.reduce((a, b) => a + Math.abs(b), 0);
      const sumRight = out.rightChannel.reduce((a, b) => a + Math.abs(b), 0);

      expect(sumRight).toBeGreaterThan(sumLeft);
    });

    it('attenuates sound with increasing distance', () => {
      const input = new Float32Array(64).fill(1.0);

      const nearSource = { position: { x: 0, y: 0, z: 1 } };
      const farSource = { position: { x: 0, y: 0, z: 10 } };

      const outNear = spatializer.spatialize(input, nearSource);
      const outFar = spatializer.spatialize(input, farSource);

      const maxNear = Math.max(...outNear.leftChannel);
      const maxFar = Math.max(...outFar.leftChannel);

      expect(maxNear).toBeGreaterThan(maxFar);
    });

    it('processes Doppler velocity shifts', () => {
      const input = new Float32Array(64).fill(0.5);
      const approachingSource = {
        position: { x: 0, y: 0, z: 10 },
        velocity: { x: 0, y: 0, z: -30 }, // Approaching at 30 m/s
      };

      const out = spatializer.spatialize(input, approachingSource);
      expect(out.sampleCount).toBe(64);
    });
  });
});
