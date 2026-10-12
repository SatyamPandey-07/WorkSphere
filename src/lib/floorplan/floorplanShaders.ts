import * as THREE from "three";

export const FLOORPLAN_BUFFER_SCALE = 0.5;

export function getFloorplanBufferSize(width: number, height: number) {
  return {
    width: Math.max(1, Math.floor(width * FLOORPLAN_BUFFER_SCALE)),
    height: Math.max(1, Math.floor(height * FLOORPLAN_BUFFER_SCALE)),
  };
}

export interface FloorplanRenderTargets {
  color: THREE.WebGLRenderTarget;
  normal: THREE.WebGLRenderTarget;
  ao: THREE.WebGLRenderTarget;
  blurA: THREE.WebGLRenderTarget;
  blurB: THREE.WebGLRenderTarget;
  setSize(width: number, height: number): void;
  dispose(): void;
}

function createTarget(
  width: number,
  height: number,
  withDepthBuffer = false,
  withDepthTexture = false,
) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: withDepthBuffer,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  target.texture.colorSpace = THREE.NoColorSpace;

  if (withDepthTexture) {
    target.depthTexture = new THREE.DepthTexture(
      width,
      height,
      THREE.UnsignedIntType,
    );
    target.depthTexture.format = THREE.DepthFormat;
    target.depthTexture.minFilter = THREE.NearestFilter;
    target.depthTexture.magFilter = THREE.NearestFilter;
  }

  return target;
}

export function createFloorplanRenderTargets(
  width: number,
  height: number,
): FloorplanRenderTargets {
  const size = getFloorplanBufferSize(width, height);
  const targets = {
    color: createTarget(size.width, size.height, true, true),
    normal: createTarget(size.width, size.height, true),
    ao: createTarget(size.width, size.height),
    blurA: createTarget(size.width, size.height),
    blurB: createTarget(size.width, size.height),
  };

  return {
    ...targets,
    setSize(nextWidth, nextHeight) {
      const nextSize = getFloorplanBufferSize(nextWidth, nextHeight);
      Object.values(targets).forEach((target) =>
        target.setSize(nextSize.width, nextSize.height),
      );
    },
    dispose() {
      Object.values(targets).forEach((target) => target.dispose());
    },
  };
}

const fullscreenVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const ssaoFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform float uNear;
  uniform float uFar;
  uniform float uRadius;

  float viewDepth(float depth) {
    return (uNear * uFar) / (uFar - depth * (uFar - uNear));
  }

  void main() {
    float depth = texture2D(tDepth, vUv).x;
    if (depth >= 0.99999) {
      gl_FragColor = vec4(1.0);
      return;
    }

    float centerDepth = viewDepth(depth);
    vec3 normal = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
    float occlusion = 0.0;
    const float TAU = 6.28318530718;
    const int SAMPLE_COUNT = 8;

    for (int i = 0; i < SAMPLE_COUNT; i++) {
      float angle = TAU * (float(i) / float(SAMPLE_COUNT));
      vec2 direction = vec2(cos(angle), sin(angle));
      vec2 sampleUv = vUv + direction * uRadius;
      float sampleRawDepth = texture2D(tDepth, sampleUv).x;
      if (sampleRawDepth < 0.99999) {
        float sampleDepth = viewDepth(sampleRawDepth);
        float depthDelta = centerDepth - sampleDepth;
        vec3 hemisphereDirection = normalize(vec3(direction, 0.45));
        float hemisphere = max(dot(normal, hemisphereDirection), 0.0);
        float rangeWeight = smoothstep(0.0, 0.18, depthDelta);
        occlusion += rangeWeight * hemisphere;
      }
    }

    float visibility = 1.0 - clamp(occlusion / float(SAMPLE_COUNT), 0.0, 0.78);
    gl_FragColor = vec4(vec3(visibility), 1.0);
  }
`;

export const bilateralBlurFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D tInput;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 uDirection;
  uniform vec2 uTexelSize;

  void main() {
    float centerDepth = texture2D(tDepth, vUv).x;
    vec3 centerNormal = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
    float centerValue = texture2D(tInput, vUv).r;
    float total = 1.0;
    float weighted = centerValue;

    for (int i = 1; i <= 3; i++) {
      float distance = float(i);
      float spatialWeight = exp(-distance * distance * 0.22);
      for (int signIndex = 0; signIndex < 2; signIndex++) {
        float signValue = signIndex == 0 ? -1.0 : 1.0;
        vec2 sampleUv = vUv + uDirection * uTexelSize * distance * signValue;
        float sampleDepth = texture2D(tDepth, sampleUv).x;
        vec3 sampleNormal = normalize(
          texture2D(tNormal, sampleUv).xyz * 2.0 - 1.0
        );
        float depthWeight = exp(-abs(sampleDepth - centerDepth) * 180.0);
        float normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 8.0);
        float weight = spatialWeight * depthWeight * normalWeight;
        weighted += texture2D(tInput, sampleUv).r * weight;
        total += weight;
      }
    }

    float result = weighted / max(total, 0.0001);
    gl_FragColor = vec4(vec3(result), 1.0);
  }
`;

export const depthCompositeFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tAo;
  uniform float uNear;
  uniform float uFar;
  uniform float uFocusDepth;
  uniform float uFocalRange;
  uniform float uAoStrength;
  uniform float uBlurStrength;
  uniform vec2 uTexelSize;

  float viewDepth(float depth) {
    return (uNear * uFar) / (uFar - depth * (uFar - uNear));
  }

  void main() {
    vec4 base = texture2D(tColor, vUv);
    float depth = texture2D(tDepth, vUv).x;
    float linearDepth = viewDepth(depth);
    float circleOfConfusion = clamp(
      (abs(linearDepth - uFocusDepth) - uFocalRange) * uBlurStrength,
      0.0,
      2.0
    );
    vec3 blurred = base.rgb;
    const int BLUR_SAMPLES = 6;
    for (int i = 0; i < BLUR_SAMPLES; i++) {
      float angle = 6.28318530718 * (float(i) / float(BLUR_SAMPLES));
      vec2 offset = vec2(cos(angle), sin(angle)) * uTexelSize * circleOfConfusion;
      blurred += texture2D(tColor, vUv + offset).rgb;
    }
    blurred /= float(BLUR_SAMPLES + 1);

    float ao = texture2D(tAo, vUv).r;
    float perimeter = smoothstep(0.36, 0.76, length(vUv - 0.5));
    float shellAttenuation = mix(1.0, 0.88, perimeter);
    vec3 color = mix(base.rgb, blurred, clamp(circleOfConfusion * 0.45, 0.0, 0.5));
    color *= mix(1.0, ao, uAoStrength);
    color *= shellAttenuation;
    gl_FragColor = vec4(color, base.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createFloorplanShaderMaterials() {
  return {
    ssao: new THREE.ShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: ssaoFragmentShader,
      uniforms: {
        tDepth: { value: null },
        tNormal: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uRadius: { value: 0.004 },
      },
      depthTest: false,
      depthWrite: false,
    }),
    bilateralBlur: new THREE.ShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: bilateralBlurFragmentShader,
      uniforms: {
        tInput: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    }),
    composite: new THREE.ShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: depthCompositeFragmentShader,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tAo: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uFocusDepth: { value: 20 },
        uFocalRange: { value: 4 },
        uAoStrength: { value: 0.72 },
        uBlurStrength: { value: 0.08 },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    }),
  };
}

export const hardLightFacetFragmentShader = `
  varying vec2 vUv;
  uniform vec2 uPointer;
  uniform float uTime;
  uniform float uFacetScale;
  uniform float uRefractionIntensity;

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
  }

  vec3 voronoi(vec2 x, float time) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float md = 8.0;
    float md2 = 8.0;
    vec2 cid = vec2(0.0);

    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(n + g);
        o = 0.5 + 0.45 * sin(time * 0.75 + 6.283185 * o);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < md) {
          md2 = md;
          md = d;
          cid = n + g;
        } else if (d < md2) {
          md2 = d;
        }
      }
    }
    return vec3(sqrt(md), sqrt(md2), length(cid));
  }

  void main() {
    vec2 uv = vUv;

    // Refraction modulated by pointer X/Y coordinates
    vec2 pointerVec = uv - uPointer;
    float pointerDist = length(pointerVec);
    float refractionWave = sin(pointerDist * 14.0 - uTime * 2.8) * exp(-pointerDist * 2.4);
    vec2 refractionOffset = normalize(pointerVec + vec2(0.0001, 0.0001)) * refractionWave * 0.05 * uRefractionIntensity;
    vec2 refractedUv = uv + refractionOffset;

    // Voronoi crystalline facets
    vec2 st = refractedUv * max(uFacetScale, 1.0);
    vec3 v = voronoi(st, uTime * 0.5);
    float f1 = v.x;
    float f2 = v.y;
    float cellId = v.z;

    float facetEdge = f2 - f1;
    float edgeGlow = 1.0 - smoothstep(0.0, 0.16, facetEdge);

    float internalRefract = sin(f1 * 22.0 + uPointer.x * 6.0 + uPointer.y * 6.0 + uTime * 2.2);
    internalRefract = smoothstep(0.35, 0.95, internalRefract);

    // Shimmering emerald caustics
    vec2 causticUv = refractedUv * (uFacetScale * 2.4) + uPointer * 0.6;
    float c1 = sin(causticUv.x * 3.6 + uTime * 2.0) * cos(causticUv.y * 3.6 - uTime * 1.6);
    float c2 = sin(causticUv.y * 4.4 + uTime * 1.4) * cos(causticUv.x * 4.4 + uTime * 2.2);
    float caustics = pow(max(0.0, c1 + c2), 3.0) * 0.8;

    vec3 deepBase = vec3(0.008, 0.065, 0.05);
    vec3 emeraldMid = vec3(0.063, 0.584, 0.404);
    vec3 causticColor = vec3(0.32, 0.94, 0.68);
    vec3 coreHighlight = vec3(0.86, 0.99, 0.93);

    vec3 col = deepBase;
    float cellVariation = fract(sin(cellId * 43.123) * 91.345);
    col = mix(col, emeraldMid, (1.0 - f1) * 0.82 + cellVariation * 0.18);
    col += causticColor * caustics * 0.85;
    col += causticColor * edgeGlow * 1.35;
    col += coreHighlight * pow(edgeGlow, 2.4) * 1.7;
    col += emeraldMid * internalRefract * 0.42;

    float vignette = smoothstep(0.0, 0.45, uv.x * (1.0 - uv.x) * uv.y * (1.0 - uv.y) * 16.0);
    col *= clamp(vignette + 0.35, 0.0, 1.0);

    gl_FragColor = vec4(col, 0.94);
  }
`;

export function createHardLightFacetMaterial(options?: {
  facetScale?: number;
  refractionIntensity?: number;
}) {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: hardLightFacetFragmentShader,
    uniforms: {
      uPointer: { value: new THREE.Vector2(0.5, 0.5) },
      uTime: { value: 0 },
      uFacetScale: { value: options?.facetScale ?? 6.0 },
      uRefractionIntensity: { value: options?.refractionIntensity ?? 1.2 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}
