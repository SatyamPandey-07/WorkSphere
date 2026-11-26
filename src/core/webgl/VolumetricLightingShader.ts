/**
 * VolumetricLightingShader.ts
 * Physical volumetric radiance lighting shader pipeline and ray-marching simulator.
 * Simulates participating media (atmospheric haze, crepuscular light shafts, daylight penetration)
 * using the Henyey-Greenstein anisotropic phase function and Beer-Lambert extinction.
 */

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

export type LightType = 'DIRECTIONAL' | 'POINT' | 'SPOT';

export interface LightSource {
  id: string;
  type: LightType;
  position?: Vector3;
  direction?: Vector3;
  color: ColorRGB;
  intensity: number;
  decay?: number;
  coneAngleRad?: number;
  penumbraAngleRad?: number;
}

export interface VolumeMedium {
  absorptionCoeff: number; // sigma_a
  scatteringCoeff: number; // sigma_s
  extinctionCoeff: number; // sigma_t = sigma_a + sigma_s
  asymmetryFactorG: number; // Henyey-Greenstein g (-1.0 to 1.0)
  density: number;
}

export interface AxisAlignedBoundingBox {
  min: Vector3;
  max: Vector3;
}

export interface RayMarchResult {
  radiance: ColorRGB;
  transmittance: number;
  sampleSteps: number;
}

export class VectorMath {
  public static add(a: Vector3, b: Vector3): Vector3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  public static sub(a: Vector3, b: Vector3): Vector3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  public static scale(v: Vector3, s: number): Vector3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  public static dot(a: Vector3, b: Vector3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  public static length(v: Vector3): number {
    return Math.sqrt(this.dot(v, v));
  }

  public static normalize(v: Vector3): Vector3 {
    const len = this.length(v);
    if (len === 0) return { x: 0, y: 0, z: 0 };
    return this.scale(v, 1 / len);
  }

  public static distance(a: Vector3, b: Vector3): number {
    return this.length(this.sub(a, b));
  }
}

export class VolumetricLightingShader {
  private medium: VolumeMedium;
  private lights: Map<string, LightSource> = new Map();
  private occluders: AxisAlignedBoundingBox[] = [];

  constructor(medium?: Partial<VolumeMedium>) {
    const sigmaA = medium?.absorptionCoeff ?? 0.05;
    const sigmaS = medium?.scatteringCoeff ?? 0.15;
    this.medium = {
      absorptionCoeff: sigmaA,
      scatteringCoeff: sigmaS,
      extinctionCoeff: medium?.extinctionCoeff ?? sigmaA + sigmaS,
      asymmetryFactorG: medium?.asymmetryFactorG ?? 0.35, // Slight forward scattering typical of indoor dust/aerosols
      density: medium?.density ?? 1.0,
    };
  }

  public getMedium(): VolumeMedium {
    return { ...this.medium };
  }

  public setMedium(medium: Partial<VolumeMedium>): void {
    if (medium.absorptionCoeff !== undefined) this.medium.absorptionCoeff = medium.absorptionCoeff;
    if (medium.scatteringCoeff !== undefined) this.medium.scatteringCoeff = medium.scatteringCoeff;
    if (medium.extinctionCoeff !== undefined) {
      this.medium.extinctionCoeff = medium.extinctionCoeff;
    } else if (medium.absorptionCoeff !== undefined || medium.scatteringCoeff !== undefined) {
      this.medium.extinctionCoeff = this.medium.absorptionCoeff + this.medium.scatteringCoeff;
    }
    if (medium.asymmetryFactorG !== undefined) this.medium.asymmetryFactorG = medium.asymmetryFactorG;
    if (medium.density !== undefined) this.medium.density = medium.density;
  }

  public addLight(light: LightSource): void {
    this.lights.set(light.id, { ...light });
  }

  public removeLight(lightId: string): void {
    this.lights.delete(lightId);
  }

  public addOccluder(box: AxisAlignedBoundingBox): void {
    this.occluders.push(box);
  }

  public clearOccluders(): void {
    this.occluders = [];
  }

  /**
   * Henyey-Greenstein Phase Function:
   * p(cosTheta, g) = (1 - g^2) / (4 * PI * (1 + g^2 - 2 * g * cosTheta)^(3/2))
   */
  public evaluatePhaseFunction(cosTheta: number, g: number = this.medium.asymmetryFactorG): number {
    const clampedG = Math.max(-0.99, Math.min(0.99, g));
    const clampedCos = Math.max(-1.0, Math.min(1.0, cosTheta));
    const g2 = clampedG * clampedG;
    const denom = Math.pow(1.0 + g2 - 2.0 * clampedG * clampedCos, 1.5);
    return (1.0 - g2) / (4.0 * Math.PI * denom);
  }

  /**
   * Beer-Lambert Law Transmittance:
   * T(distance) = exp(-sigma_t * density * distance)
   */
  public evaluateTransmittance(distance: number): number {
    if (distance <= 0) return 1.0;
    const opticalDepth = this.medium.extinctionCoeff * this.medium.density * distance;
    return Math.exp(-opticalDepth);
  }

  /**
   * Fast Ray-AABB intersection test for shadow volume occlusion
   */
  public isRayOccluded(origin: Vector3, target: Vector3): boolean {
    const rayDir = VectorMath.sub(target, origin);
    const maxDist = VectorMath.length(rayDir);
    if (maxDist === 0) return false;
    const dir = VectorMath.normalize(rayDir);

    for (const box of this.occluders) {
      let tmin = (box.min.x - origin.x) / (dir.x !== 0 ? dir.x : 1e-9);
      let tmax = (box.max.x - origin.x) / (dir.x !== 0 ? dir.x : 1e-9);
      if (tmin > tmax) [tmin, tmax] = [tmax, tmin];

      let tymin = (box.min.y - origin.y) / (dir.y !== 0 ? dir.y : 1e-9);
      let tymax = (box.max.y - origin.y) / (dir.y !== 0 ? dir.y : 1e-9);
      if (tymin > tymax) [tymin, tymax] = [tymax, tymin];

      if (tmin > tymax || tymin > tmax) continue;
      if (tymin > tmin) tmin = tymin;
      if (tymax < tmax) tmax = tymax;

      let tzmin = (box.min.z - origin.z) / (dir.z !== 0 ? dir.z : 1e-9);
      let tzmax = (box.max.z - origin.z) / (dir.z !== 0 ? dir.z : 1e-9);
      if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];

      if (tmin > tzmax || tzmin > tmax) continue;
      if (tzmin > tmin) tmin = tzmin;
      if (tzmax < tmax) tmax = tzmax;

      if (tmax > 0.001 && tmin < maxDist) {
        return true; // Occluded
      }
    }

    return false;
  }

  /**
   * Ray-Marching In-Scattered Radiance Integration
   */
  public marchRay(
    cameraPos: Vector3,
    viewDirNorm: Vector3,
    maxDistance: number,
    stepCount: number = 64
  ): RayMarchResult {
    const stepSize = maxDistance / Math.max(1, stepCount);
    let accumRadiance: ColorRGB = { r: 0, g: 0, b: 0 };
    let accumTransmittance = 1.0;

    const sigmaS = this.medium.scatteringCoeff * this.medium.density;
    const stepTransmittance = Math.exp(-this.medium.extinctionCoeff * this.medium.density * stepSize);

    for (let i = 0; i < stepCount; i++) {
      const t = (i + 0.5) * stepSize;
      const samplePoint = VectorMath.add(cameraPos, VectorMath.scale(viewDirNorm, t));

      let stepInScatter: ColorRGB = { r: 0, g: 0, b: 0 };

      for (const light of this.lights.values()) {
        let lightDir: Vector3;
        let attenuation = 1.0;
        let occluded = false;

        if (light.type === 'DIRECTIONAL') {
          lightDir = VectorMath.normalize(VectorMath.scale(light.direction ?? { x: 0, y: -1, z: 0 }, -1));
          // Shadow test against far virtual boundary
          const shadowTarget = VectorMath.add(samplePoint, VectorMath.scale(lightDir, 100));
          occluded = this.isRayOccluded(samplePoint, shadowTarget);
          attenuation = light.intensity;
        } else if (light.type === 'POINT') {
          const lightPos = light.position ?? { x: 0, y: 5, z: 0 };
          const dist = VectorMath.distance(samplePoint, lightPos);
          lightDir = VectorMath.normalize(VectorMath.sub(lightPos, samplePoint));
          occluded = this.isRayOccluded(samplePoint, lightPos);
          const decay = light.decay ?? 2.0;
          attenuation = light.intensity / Math.pow(1.0 + dist, decay);
        } else {
          // SPOT light
          const lightPos = light.position ?? { x: 0, y: 5, z: 0 };
          const spotDir = VectorMath.normalize(light.direction ?? { x: 0, y: -1, z: 0 });
          const toSample = VectorMath.sub(samplePoint, lightPos);
          const dist = VectorMath.length(toSample);
          lightDir = VectorMath.normalize(VectorMath.sub(lightPos, samplePoint));
          occluded = this.isRayOccluded(samplePoint, lightPos);

          const cosCone = VectorMath.dot(VectorMath.normalize(toSample), spotDir);
          const cutoff = Math.cos(light.coneAngleRad ?? 0.5);
          if (cosCone < cutoff) {
            attenuation = 0;
          } else {
            const penumbraCutoff = Math.cos((light.coneAngleRad ?? 0.5) + (light.penumbraAngleRad ?? 0.2));
            const spotFalloff = Math.max(0, Math.min(1, (cosCone - cutoff) / (1.0 - cutoff)));
            attenuation = (light.intensity / (1.0 + dist * dist)) * spotFalloff;
          }
        }

        if (occluded || attenuation <= 0) continue;

        // Angle between incoming light and viewing ray
        const cosTheta = VectorMath.dot(lightDir, viewDirNorm);
        const phase = this.evaluatePhaseFunction(cosTheta, this.medium.asymmetryFactorG);

        stepInScatter.r += light.color.r * attenuation * phase * sigmaS;
        stepInScatter.g += light.color.g * attenuation * phase * sigmaS;
        stepInScatter.b += light.color.b * attenuation * phase * sigmaS;
      }

      // Integrate step into accumulated radiance
      accumRadiance.r += stepInScatter.r * accumTransmittance * stepSize;
      accumRadiance.g += stepInScatter.g * accumTransmittance * stepSize;
      accumRadiance.b += stepInScatter.b * accumTransmittance * stepSize;

      accumTransmittance *= stepTransmittance;
      if (accumTransmittance < 0.001) break; // Early exit on total extinction
    }

    return {
      radiance: accumRadiance,
      transmittance: accumTransmittance,
      sampleSteps: stepCount,
    };
  }

  /**
   * Programmatic WebGL2 GLSL Shader Code Generation
   */
  public generateWebGL2ShaderSources(): { vertexShader: string; fragmentShader: string } {
    const vertexShader = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_texCoord;

out vec2 v_texCoord;
out vec3 v_rayDir;

uniform mat4 u_invViewProj;
uniform vec3 u_cameraPos;

void main() {
    v_texCoord = a_texCoord;
    vec4 clipPos = vec4(a_position.xy, 1.0, 1.0);
    vec4 worldPos = u_invViewProj * clipPos;
    v_rayDir = normalize(worldPos.xyz / worldPos.w - u_cameraPos);
    gl_Position = vec4(a_position.xy, 0.0, 1.0);
}
`;

    const fragmentShader = `#version 300 es
precision highp float;

in vec2 v_texCoord;
in vec3 v_rayDir;

out vec4 fragColor;

uniform vec3 u_cameraPos;
uniform vec3 u_lightPos;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform float u_sigmaA;
uniform float u_sigmaS;
uniform float u_phaseG;
uniform float u_maxDist;
uniform int u_stepCount;
uniform sampler2D u_depthTexture;

#define PI 3.14159265359

float henyeyGreenstein(float cosTheta, float g) {
    float g2 = g * g;
    float denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return (1.0 - g2) / (4.0 * PI * denom);
}

void main() {
    float sigmaT = u_sigmaA + u_sigmaS;
    float stepSize = u_maxDist / float(u_stepCount);
    vec3 accumRadiance = vec3(0.0);
    float accumTransmittance = 1.0;
    float stepTransmittance = exp(-sigmaT * stepSize);

    for (int i = 0; i < u_stepCount; i++) {
        float t = (float(i) + 0.5) * stepSize;
        vec3 samplePos = u_cameraPos + v_rayDir * t;
        vec3 toLight = u_lightPos - samplePos;
        float lightDist = length(toLight);
        vec3 lightDir = normalize(toLight);

        float atten = u_lightIntensity / (1.0 + lightDist * lightDist);
        float cosTheta = dot(lightDir, v_rayDir);
        float phase = henyeyGreenstein(cosTheta, u_phaseG);

        vec3 inScatter = u_lightColor * atten * phase * u_sigmaS;
        accumRadiance += inScatter * accumTransmittance * stepSize;
        accumTransmittance *= stepTransmittance;

        if (accumTransmittance < 0.002) break;
    }

    fragColor = vec4(accumRadiance, 1.0 - accumTransmittance);
}
`;

    return { vertexShader, fragmentShader };
  }
}
