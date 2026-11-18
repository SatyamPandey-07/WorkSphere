import {
  VolumetricLightingShader,
  VectorMath,
  LightSource,
  AxisAlignedBoundingBox,
} from '../../core/webgl/VolumetricLightingShader';

describe('VolumetricLightingShader', () => {
  let shader: VolumetricLightingShader;

  beforeEach(() => {
    shader = new VolumetricLightingShader({
      absorptionCoeff: 0.05,
      scatteringCoeff: 0.15,
      asymmetryFactorG: 0.35,
      density: 1.0,
    });
  });

  describe('VectorMath Helpers', () => {
    it('computes basic vector operations correctly', () => {
      const a = { x: 1, y: 2, z: 3 };
      const b = { x: 4, y: 5, z: 6 };

      const sum = VectorMath.add(a, b);
      expect(sum).toEqual({ x: 5, y: 7, z: 9 });

      const diff = VectorMath.sub(b, a);
      expect(diff).toEqual({ x: 3, y: 3, z: 3 });

      const dot = VectorMath.dot(a, b);
      expect(dot).toBe(1 * 4 + 2 * 5 + 3 * 6); // 4 + 10 + 18 = 32

      const norm = VectorMath.normalize({ x: 0, y: 3, z: 4 });
      expect(norm.x).toBeCloseTo(0);
      expect(norm.y).toBeCloseTo(0.6);
      expect(norm.z).toBeCloseTo(0.8);
    });
  });

  describe('Henyey-Greenstein Phase Function', () => {
    it('yields uniform 1 / (4 * PI) when g = 0 (isotropic scattering)', () => {
      const g = 0;
      const expected = 1.0 / (4.0 * Math.PI);

      expect(shader.evaluatePhaseFunction(1.0, g)).toBeCloseTo(expected, 5);
      expect(shader.evaluatePhaseFunction(0.0, g)).toBeCloseTo(expected, 5);
      expect(shader.evaluatePhaseFunction(-1.0, g)).toBeCloseTo(expected, 5);
    });

    it('peaks in forward direction (cosTheta = 1) when g > 0', () => {
      const g = 0.5;
      const forward = shader.evaluatePhaseFunction(1.0, g);
      const side = shader.evaluatePhaseFunction(0.0, g);
      const backward = shader.evaluatePhaseFunction(-1.0, g);

      expect(forward).toBeGreaterThan(side);
      expect(side).toBeGreaterThan(backward);
    });

    it('peaks in backward direction (cosTheta = -1) when g < 0', () => {
      const g = -0.4;
      const forward = shader.evaluatePhaseFunction(1.0, g);
      const backward = shader.evaluatePhaseFunction(-1.0, g);

      expect(backward).toBeGreaterThan(forward);
    });
  });

  describe('Beer-Lambert Law Transmittance', () => {
    it('transmittance is 1.0 at zero distance', () => {
      expect(shader.evaluateTransmittance(0)).toBe(1.0);
    });

    it('transmittance decays exponentially over distance', () => {
      const t1 = shader.evaluateTransmittance(2.0);
      const t2 = shader.evaluateTransmittance(5.0);
      const t3 = shader.evaluateTransmittance(10.0);

      expect(t1).toBeLessThan(1.0);
      expect(t2).toBeLessThan(t1);
      expect(t3).toBeLessThan(t2);

      // Verify exact formula T = exp(-sigma_t * density * d)
      const expected = Math.exp(-(0.05 + 0.15) * 1.0 * 5.0);
      expect(t2).toBeCloseTo(expected, 6);
    });
  });

  describe('Ray-Marching & Crepuscular Shafts', () => {
    it('accumulates in-scattered radiance from directional light', () => {
      const sun: LightSource = {
        id: 'sun',
        type: 'DIRECTIONAL',
        direction: { x: 0, y: -1, z: 0 },
        color: { r: 1.0, g: 0.95, b: 0.8 },
        intensity: 5.0,
      };
      shader.addLight(sun);

      const cameraPos = { x: 0, y: 1, z: 0 };
      const viewDir = { x: 0, y: 0, z: 1 }; // Looking forward
      const result = shader.marchRay(cameraPos, viewDir, 20.0, 32);

      expect(result.radiance.r).toBeGreaterThan(0);
      expect(result.radiance.g).toBeGreaterThan(0);
      expect(result.radiance.b).toBeGreaterThan(0);
      expect(result.transmittance).toBeLessThan(1.0);
    });

    it('shadow occluder completely blocks in-scattering along light path', () => {
      const pointLight: LightSource = {
        id: 'desk-lamp',
        type: 'POINT',
        position: { x: 0, y: 3, z: 5 },
        color: { r: 1.0, g: 1.0, b: 1.0 },
        intensity: 10.0,
      };
      shader.addLight(pointLight);

      // Unoccluded ray
      const unoccludedRes = shader.marchRay({ x: 0, y: 0, z: 5 }, { x: 0, y: 1, z: 0 }, 2.0, 16);
      expect(unoccludedRes.radiance.r).toBeGreaterThan(0);

      // Add solid partition occluding the sample segment
      const partition: AxisAlignedBoundingBox = {
        min: { x: -2, y: 1, z: 4 },
        max: { x: 2, y: 2.5, z: 6 },
      };
      shader.addOccluder(partition);

      const occludedRes = shader.marchRay({ x: 0, y: 0, z: 5 }, { x: 0, y: 1, z: 0 }, 0.5, 8);
      expect(occludedRes.radiance.r).toBe(0);
    });

    it('spotlight evaluates angular cone falloff correctly', () => {
      const spotLight: LightSource = {
        id: 'spot-1',
        type: 'SPOT',
        position: { x: 0, y: 10, z: 0 },
        direction: { x: 0, y: -1, z: 0 },
        coneAngleRad: 0.2, // ~11 degrees
        color: { r: 1.0, g: 1.0, b: 1.0 },
        intensity: 8.0,
      };
      shader.addLight(spotLight);

      // Sample directly below spot (inside cone)
      const insideRes = shader.marchRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 4.0, 16);
      expect(insideRes.radiance.r).toBeGreaterThan(0);

      // Sample far to the side (outside cone)
      const outsideRes = shader.marchRay({ x: 20, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 4.0, 16);
      expect(outsideRes.radiance.r).toBe(0);
    });
  });

  describe('WebGL2 Shader Code Generation', () => {
    it('generates compilable WebGL2 GLSL shader strings', () => {
      const { vertexShader, fragmentShader } = shader.generateWebGL2ShaderSources();

      expect(vertexShader).toContain('#version 300 es');
      expect(vertexShader).toContain('layout(location = 0) in vec3 a_position;');
      expect(vertexShader).toContain('v_rayDir');

      expect(fragmentShader).toContain('#version 300 es');
      expect(fragmentShader).toContain('precision highp float;');
      expect(fragmentShader).toContain('float henyeyGreenstein(');
      expect(fragmentShader).toContain('u_sigmaA + u_sigmaS');
      expect(fragmentShader).toContain('fragColor = vec4(');
    });
  });
});
