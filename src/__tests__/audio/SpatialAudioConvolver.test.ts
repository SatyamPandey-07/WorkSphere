import {
  SpatialAudioConvolver,
  Vector3D,
  Orientation3D,
  SphericalCoordinates,
} from '../../core/audio/SpatialAudioConvolver';

describe('SpatialAudioConvolver', () => {
  let convolver: SpatialAudioConvolver;

  beforeEach(() => {
    convolver = new SpatialAudioConvolver({
      sampleRate: 48000,
      headRadiusMeters: 0.0875,
      speedOfSound: 343,
      refDistance: 1.0,
      maxDistance: 50.0,
      rolloffFactor: 1.0,
      irLengthSamples: 128,
    });
  });

  describe('Coordinate System & Spatial Positioning', () => {
    it('calculates correct spherical coordinates for straight ahead emitter', () => {
      convolver.setListenerPosition({ x: 0, y: 0, z: 0 });
      convolver.setEmitterPosition({ x: 0, y: 0, z: 5 });

      const coords = convolver.getSphericalCoordinates();
      expect(coords.distance).toBeCloseTo(5, 3);
      expect(coords.azimuth).toBeCloseTo(0, 1);
      expect(coords.elevation).toBeCloseTo(0, 1);
    });

    it('calculates positive azimuth (+90 deg) for emitter to the right', () => {
      convolver.setListenerPosition({ x: 0, y: 0, z: 0 });
      convolver.setEmitterPosition({ x: 10, y: 0, z: 0 });

      const coords = convolver.getSphericalCoordinates();
      expect(coords.distance).toBeCloseTo(10, 3);
      expect(coords.azimuth).toBeCloseTo(90, 1);
      expect(coords.elevation).toBeCloseTo(0, 1);
    });

    it('calculates negative azimuth (-90 deg) for emitter to the left', () => {
      convolver.setListenerPosition({ x: 0, y: 0, z: 0 });
      convolver.setEmitterPosition({ x: -10, y: 0, z: 0 });

      const coords = convolver.getSphericalCoordinates();
      expect(coords.distance).toBeCloseTo(10, 3);
      expect(coords.azimuth).toBeCloseTo(-90, 1);
      expect(coords.elevation).toBeCloseTo(0, 1);
    });

    it('calculates elevation correctly for emitter above listener', () => {
      convolver.setListenerPosition({ x: 0, y: 0, z: 0 });
      convolver.setEmitterPosition({ x: 0, y: 10, z: 0 });

      const coords = convolver.getSphericalCoordinates();
      expect(coords.distance).toBeCloseTo(10, 3);
      expect(coords.elevation).toBeCloseTo(90, 1);
    });

    it('adjusts perceived coordinates when listener rotates head (yaw)', () => {
      // Emitter directly ahead in world space at (0, 0, 5)
      convolver.setListenerPosition({ x: 0, y: 0, z: 0 });
      convolver.setEmitterPosition({ x: 0, y: 0, z: 5 });

      // Listener turns head 90 deg right (+yaw)
      convolver.setListenerOrientation({ yaw: 90, pitch: 0, roll: 0 });

      // Relative to listener's head, emitter is now to the left (-90 deg)
      const coords = convolver.getSphericalCoordinates();
      expect(coords.azimuth).toBeCloseTo(-90, 1);
    });
  });

  describe('Woodworth ITD & ILD Modeling', () => {
    it('yields zero delay delta when sound source is directly center front (azimuth = 0)', () => {
      const itd = convolver.computeWoodworthITD(0);
      expect(itd.deltaSec).toBeCloseTo(0, 5);
      expect(itd.leftDelaySec).toBeCloseTo(0, 5);
      expect(itd.rightDelaySec).toBeCloseTo(0, 5);
    });

    it('computes contralateral delay when source is on right (+90 deg)', () => {
      const itd = convolver.computeWoodworthITD(90);
      // Sound on right arrives at right ear first (rightDelaySec = 0)
      expect(itd.rightDelaySec).toBe(0);
      // Woodworth formula at 90 deg: a/c * (1 + pi/2)
      const expectedDelay = (0.0875 / 343) * (1 + Math.PI / 2);
      expect(itd.leftDelaySec).toBeCloseTo(expectedDelay, 4);
      expect(itd.deltaSec).toBeCloseTo(expectedDelay, 4);
    });

    it('computes symmetrical contralateral delay when source is on left (-90 deg)', () => {
      const itd = convolver.computeWoodworthITD(-90);
      expect(itd.leftDelaySec).toBe(0);
      const expectedDelay = (0.0875 / 343) * (1 + Math.PI / 2);
      expect(itd.rightDelaySec).toBeCloseTo(expectedDelay, 4);
      expect(itd.deltaSec).toBeCloseTo(-expectedDelay, 4);
    });

    it('computes ILD attenuation and head shadow shelving filters', () => {
      const ildCenter = convolver.computeILD(0);
      expect(ildCenter.leftGain).toBeCloseTo(ildCenter.rightGain, 2);
      expect(ildCenter.leftHighShelfGain).toBe(1.0);
      expect(ildCenter.rightHighShelfGain).toBe(1.0);

      const ildRight = convolver.computeILD(90);
      expect(ildRight.rightGain).toBeGreaterThan(ildRight.leftGain);
      expect(ildRight.leftHighShelfGain).toBeLessThan(ildRight.rightHighShelfGain);
    });
  });

  describe('Distance Attenuation & Doppler Factor', () => {
    it('clamps gain to 1.0 within reference distance', () => {
      expect(convolver.computeDistanceGain(0.5)).toBe(1.0);
      expect(convolver.computeDistanceGain(1.0)).toBe(1.0);
    });

    it('attenuates gain inversely with distance beyond refDistance', () => {
      const gain2m = convolver.computeDistanceGain(2.0);
      const gain4m = convolver.computeDistanceGain(4.0);
      expect(gain2m).toBeLessThan(1.0);
      expect(gain4m).toBeLessThan(gain2m);
    });

    it('computes Doppler frequency shift for moving emitter and listener', () => {
      convolver.setListenerPosition({ x: 0, y: 0, z: 0 });
      convolver.setEmitterPosition({ x: 0, y: 0, z: 10 });

      // Emitter moving toward listener at 34.3 m/s (~10% speed of sound)
      convolver.setEmitterVelocity({ x: 0, y: 0, z: -34.3 });
      convolver.setListenerVelocity({ x: 0, y: 0, z: 0 });

      const dopplerApproaching = convolver.computeDopplerFactor();
      expect(dopplerApproaching).toBeGreaterThan(1.0);

      // Emitter moving away from listener
      convolver.setEmitterVelocity({ x: 0, y: 0, z: 34.3 });
      const dopplerReceding = convolver.computeDopplerFactor();
      expect(dopplerReceding).toBeLessThan(1.0);
    });
  });

  describe('Binaural HRTF Impulse Response Synthesis', () => {
    it('synthesizes non-empty stereo impulse response pair', () => {
      const ir = convolver.getBinauralImpulseResponse();
      expect(ir.leftIR.length).toBe(128);
      expect(ir.rightIR.length).toBe(128);
      expect(ir.sampleRate).toBe(48000);

      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let i = 0; i < ir.leftIR.length; i++) {
        leftEnergy += ir.leftIR[i] * ir.leftIR[i];
        rightEnergy += ir.rightIR[i] * ir.rightIR[i];
      }
      expect(leftEnergy).toBeGreaterThan(0);
      expect(rightEnergy).toBeGreaterThan(0);
    });
  });

  describe('Overlap-Add Block Convolution', () => {
    it('convolves unit impulse and reproduces HRIR waveform', () => {
      convolver.setEmitterPosition({ x: 2, y: 0, z: 2 });
      const ir = convolver.getBinauralImpulseResponse();

      // Input buffer with unit impulse at sample 0
      const input = new Float32Array(128);
      input[0] = 1.0;

      const output = convolver.convolveBlock(input);
      expect(output.left.length).toBe(128);
      expect(output.right.length).toBe(128);

      // Output should match the beginning of the IR
      for (let i = 0; i < 32; i++) {
        expect(output.left[i]).toBeCloseTo(ir.leftIR[i], 4);
        expect(output.right[i]).toBeCloseTo(ir.rightIR[i], 4);
      }
    });

    it('maintains continuous energy across multiple consecutive audio blocks', () => {
      convolver.resetOverlapBuffers();
      const blockSize = 64;
      const block1 = new Float32Array(blockSize);
      const block2 = new Float32Array(blockSize);

      // Pulse near end of block 1
      block1[58] = 1.0;

      const out1 = convolver.convolveBlock(block1);
      const out2 = convolver.convolveBlock(block2);

      // Block 2 should have non-zero energy carried over via overlap-add buffer
      let tailEnergy = 0;
      for (let i = 0; i < out2.left.length; i++) {
        tailEnergy += out2.left[i] * out2.left[i] + out2.right[i] * out2.right[i];
      }
      expect(tailEnergy).toBeGreaterThan(0);
    });
  });

  describe('Room Acoustics & Early Reflections', () => {
    it('generates 6 primary early reflection image sources with correct delays', () => {
      convolver.setListenerPosition({ x: 2, y: 1.5, z: 3 });
      convolver.setEmitterPosition({ x: 5, y: 1.5, z: 4 });

      const reflections = convolver.computeRoomEarlyReflections({
        roomDimensions: { x: 10, y: 8, z: 12 },
        wallAbsorption: 0.2,
        reflectionCount: 6,
      });

      expect(reflections.length).toBe(6);
      for (const ref of reflections) {
        expect(ref.delaySec).toBeGreaterThan(0);
        expect(ref.gain).toBeGreaterThan(0);
        expect(ref.gain).toBeLessThanOrEqual(1.0);
      }
    });
  });
});
