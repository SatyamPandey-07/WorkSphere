/**
 * @file BinauralSpatializer.test.ts
 * @description Comprehensive unit test suite for BinauralSpatializer HRTF 3D audio engine,
 * Woodworth ITD calculations, head-shadowing ILD modeling, and real-time buffer spatialization.
 */

import {
  BinauralSpatializer,
  type Vector3,
  type ListenerOrientation
} from '../../core/audio/BinauralSpatializer';

describe('BinauralSpatializer 3D Audio Processing Engine', () => {
  let spatializer: BinauralSpatializer;

  beforeEach(() => {
    spatializer = new BinauralSpatializer({
      sampleRate: 48000,
      headRadiusMeters: 0.0875,
      speedOfSound: 343.0,
      referenceDistance: 1.0,
      maxDistance: 50.0,
      rolloffFactor: 1.0,
      distanceModel: 'inverse'
    });
  });

  describe('3D Coordinate Transformation', () => {
    it('calculates relative spherical coordinates for an emitter directly ahead', () => {
      spatializer.setListenerPosition({ x: 0, y: 0, z: 0 });
      spatializer.setListenerOrientation({ yaw: 0, pitch: 0, roll: 0 });

      const emitter: Vector3 = { x: 0, y: 0, z: 5 }; // 5m in front
      const coords = spatializer.calculateRelativeCoordinates(emitter);

      expect(coords.distance).toBeCloseTo(5.0, 3);
      expect(coords.azimuth).toBeCloseTo(0.0, 1);
      expect(coords.elevation).toBeCloseTo(0.0, 1);
    });

    it('calculates 90 degree azimuth for an emitter to the direct right', () => {
      const emitter: Vector3 = { x: 4, y: 0, z: 0 }; // 4m right
      const coords = spatializer.calculateRelativeCoordinates(emitter);

      expect(coords.distance).toBeCloseTo(4.0, 3);
      expect(coords.azimuth).toBeCloseTo(90.0, 1);
      expect(coords.elevation).toBeCloseTo(0.0, 1);
    });

    it('calculates -90 degree azimuth for an emitter to the direct left', () => {
      const emitter: Vector3 = { x: -4, y: 0, z: 0 }; // 4m left
      const coords = spatializer.calculateRelativeCoordinates(emitter);

      expect(coords.distance).toBeCloseTo(4.0, 3);
      expect(coords.azimuth).toBeCloseTo(-90.0, 1);
      expect(coords.elevation).toBeCloseTo(0.0, 1);
    });

    it('accounts for listener head yaw rotation', () => {
      // Listener turns 90 degrees right (yaw = 90)
      spatializer.setListenerOrientation({ yaw: 90, pitch: 0, roll: 0 });

      // Emitter is at (0, 0, 5) which was ahead, now should appear to listener's left (-90 deg)
      const emitter: Vector3 = { x: 0, y: 0, z: 5 };
      const coords = spatializer.calculateRelativeCoordinates(emitter);

      expect(coords.azimuth).toBeCloseTo(-90.0, 1);
    });
  });

  describe('Woodworth-Schlosser ITD Modeling', () => {
    it('produces zero ITD for sound directly in front (azimuth = 0)', () => {
      const { itdSeconds, delayLeftSec, delayRightSec } = spatializer.calculateITD(0);
      expect(itdSeconds).toBeCloseTo(0, 5);
      expect(delayLeftSec).toBe(0);
      expect(delayRightSec).toBe(0);
    });

    it('calculates accurate maximum ITD for lateral sound at 90 degrees (~0.65ms)', () => {
      const { itdSeconds, delayLeftSec, delayRightSec } = spatializer.calculateITD(90);
      // Theoretical: r/c * (pi/2 + 1) = (0.0875 / 343) * (1.5708 + 1) = ~0.000655s = 0.655ms
      expect(itdSeconds).toBeGreaterThan(0.0006);
      expect(itdSeconds).toBeLessThan(0.0007);

      // Sound is on the right: right ear has 0 delay, left ear is delayed
      expect(delayRightSec).toBe(0);
      expect(delayLeftSec).toBe(itdSeconds);
    });

    it('assigns contralateral delay to right ear when sound is on left (-90 degrees)', () => {
      const { itdSeconds, delayLeftSec, delayRightSec } = spatializer.calculateITD(-90);
      expect(delayLeftSec).toBe(0);
      expect(delayRightSec).toBe(itdSeconds);
    });
  });

  describe('Distance Attenuation & ILD', () => {
    it('calculates inverse distance attenuation correctly', () => {
      expect(spatializer.calculateDistanceAttenuation(1.0)).toBeCloseTo(1.0, 3);
      expect(spatializer.calculateDistanceAttenuation(2.0)).toBeCloseTo(0.5, 3);
      expect(spatializer.calculateDistanceAttenuation(5.0)).toBeCloseTo(0.2, 3);
      expect(spatializer.calculateDistanceAttenuation(50.0)).toBe(0.0); // at maxDistance
    });

    it('applies head-shadowing damping to the contralateral ear', () => {
      // Sound on right (azimuth = 90) at 1m distance
      const { gainLeft, gainRight } = spatializer.calculateEarGains(90, 1.0);

      expect(gainRight).toBeCloseTo(1.0, 2);
      expect(gainLeft).toBeLessThan(gainRight);
      expect(gainLeft).toBeCloseTo(0.35, 2); // 1 - 0.65
    });

    it('supports linear and exponential distance models', () => {
      const linearSpatializer = new BinauralSpatializer({
        distanceModel: 'linear',
        referenceDistance: 1.0,
        maxDistance: 11.0,
        rolloffFactor: 1.0
      });
      expect(linearSpatializer.calculateDistanceAttenuation(6.0)).toBeCloseTo(0.5, 2);

      const expSpatializer = new BinauralSpatializer({
        distanceModel: 'exponential',
        referenceDistance: 1.0,
        rolloffFactor: 2.0
      });
      expect(expSpatializer.calculateDistanceAttenuation(2.0)).toBeCloseTo(0.25, 2);
    });
  });

  describe('Buffer Spatialization & Multi-Source Mixing', () => {
    it('spatializeBuffer outputs stereo buffers with left-bias for left-side source', () => {
      const frameCount = 1024;
      const mono = new Float32Array(frameCount);
      // Generate sine wave
      for (let i = 0; i < frameCount; i++) {
        mono[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
      }

      const leftEmitter: Vector3 = { x: -3, y: 0, z: 2 };
      const stereo = spatializer.spatializeBuffer(mono, leftEmitter);

      expect(stereo.frameCount).toBe(frameCount);
      expect(stereo.left.length).toBe(frameCount);
      expect(stereo.right.length).toBe(frameCount);

      // Compute RMS power
      let leftPower = 0;
      let rightPower = 0;
      for (let i = 200; i < frameCount; i++) { // Skip initial ramp
        leftPower += stereo.left[i] * stereo.left[i];
        rightPower += stereo.right[i] * stereo.right[i];
      }

      // Left ear should receive substantially more power than right ear
      expect(leftPower).toBeGreaterThan(rightPower * 1.5);
    });

    it('mixScene combines multiple sources with peak soft-limiting', () => {
      spatializer.registerSource('speaker-1', { x: -2, y: 0, z: 2 }, 1.0);
      spatializer.registerSource('speaker-2', { x: 2, y: 0, z: 2 }, 1.0);

      const frameCount = 512;
      const buf1 = new Float32Array(frameCount).fill(0.8);
      const buf2 = new Float32Array(frameCount).fill(0.8);

      const map = new Map<string, Float32Array>();
      map.set('speaker-1', buf1);
      map.set('speaker-2', buf2);

      const mix = spatializer.mixScene(map);

      expect(mix.frameCount).toBe(frameCount);
      for (let i = 0; i < frameCount; i++) {
        // Soft tanh limiting ensures output is strictly within [-1.0, 1.0]
        expect(mix.left[i]).toBeLessThanOrEqual(1.0);
        expect(mix.left[i]).toBeGreaterThanOrEqual(-1.0);
        expect(mix.right[i]).toBeLessThanOrEqual(1.0);
        expect(mix.right[i]).toBeGreaterThanOrEqual(-1.0);
      }
    });
  });
});
