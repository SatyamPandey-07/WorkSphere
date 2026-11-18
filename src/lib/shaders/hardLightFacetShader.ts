/**
 * Hard-Light Crystalline Facet & Shimmering Emerald Caustics Shader
 *
 * Implements a GLSL fragment shader generating faceted Voronoi construct patterns,
 * emerald caustics, and pointer-driven surface refractions evoking a solid Green Lantern
 * hard-light construct.
 */

export const HARD_LIGHT_VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = (aPosition + 1.0) * 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export const HARD_LIGHT_FRAGMENT_SHADER = `
  precision mediump float;

  uniform vec2 uResolution;
  uniform vec2 uPointer;
  uniform float uTime;
  uniform float uFacetScale;
  uniform float uRefractionIntensity;

  varying vec2 vUv;

  // 2D Pseudo-random hash
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
  }

  // 2D Voronoi returning F1 (nearest), F2 (second nearest), and cell ID
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
        // Harmonic facet jitter evoking solid crystal lattice energy
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
    vec2 uv = gl_FragCoord.xy / max(uResolution.xy, vec2(1.0, 1.0));

    // Surface refraction modulated by pointer X/Y coordinates
    vec2 pointerVec = uv - uPointer;
    float pointerDist = length(pointerVec);
    
    // Non-linear refraction displacement wave radiating from pointer coordinates
    float refractionWave = sin(pointerDist * 14.0 - uTime * 2.8) * exp(-pointerDist * 2.4);
    vec2 refractionOffset = normalize(pointerVec + vec2(0.0001, 0.0001)) * refractionWave * 0.05 * uRefractionIntensity;
    vec2 refractedUv = uv + refractionOffset;

    // Faceted Voronoi crystalline construct pattern
    vec2 st = refractedUv * max(uFacetScale, 1.0);
    vec3 v = voronoi(st, uTime * 0.5);
    float f1 = v.x;
    float f2 = v.y;
    float cellId = v.z;

    // Facet edge detection for crystalline facets
    float facetEdge = f2 - f1;
    float edgeGlow = 1.0 - smoothstep(0.0, 0.16, facetEdge);

    // Internal geometric energy refractions
    float internalRefract = sin(f1 * 22.0 + uPointer.x * 6.0 + uPointer.y * 6.0 + uTime * 2.2);
    internalRefract = smoothstep(0.35, 0.95, internalRefract);

    // Shimmering emerald caustics
    vec2 causticUv = refractedUv * (uFacetScale * 2.4) + uPointer * 0.6;
    float c1 = sin(causticUv.x * 3.6 + uTime * 2.0) * cos(causticUv.y * 3.6 - uTime * 1.6);
    float c2 = sin(causticUv.y * 4.4 + uTime * 1.4) * cos(causticUv.x * 4.4 + uTime * 2.2);
    float caustics = pow(max(0.0, c1 + c2), 3.0) * 0.8;

    // Green Lantern Hard-Light Emerald Palette
    vec3 deepBase = vec3(0.008, 0.065, 0.05);     // Dark emerald base #02140f
    vec3 emeraldMid = vec3(0.063, 0.584, 0.404);  // Emerald mid #10b981
    vec3 causticColor = vec3(0.32, 0.94, 0.68);   // Shimmering emerald caustic #34d399
    vec3 coreHighlight = vec3(0.86, 0.99, 0.93);  // Crystalline hard-light highlight #ecfdf5

    // Layered energy composition
    vec3 col = deepBase;
    float cellVariation = fract(sin(cellId * 43.123) * 91.345);
    col = mix(col, emeraldMid, (1.0 - f1) * 0.82 + cellVariation * 0.18);

    // Add shimmering emerald caustics
    col += causticColor * caustics * 0.85;

    // Add crystalline hard-light facet edge glow & specular lines
    col += causticColor * edgeGlow * 1.35;
    col += coreHighlight * pow(edgeGlow, 2.4) * 1.7;
    col += emeraldMid * internalRefract * 0.42;

    // Edge vignette attenuation
    float vignette = smoothstep(0.0, 0.45, uv.x * (1.0 - uv.x) * uv.y * (1.0 - uv.y) * 16.0);
    col *= clamp(vignette + 0.35, 0.0, 1.0);

    gl_FragColor = vec4(col, 0.94);
  }
`;

export interface WebGLProgramBundle {
  program: WebGLProgram;
  uniforms: {
    uResolution: WebGLUniformLocation | null;
    uPointer: WebGLUniformLocation | null;
    uTime: WebGLUniformLocation | null;
    uFacetScale: WebGLUniformLocation | null;
    uRefractionIntensity: WebGLUniformLocation | null;
  };
  attributes: {
    aPosition: number;
  };
  buffer: WebGLBuffer | null;
}

/**
 * Compiles and links the Hard-Light Crystalline Facet WebGL program.
 */
export function initHardLightWebGL(
  gl: WebGLRenderingContext,
): WebGLProgramBundle | null {
  function createShader(type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertShader = createShader(gl.VERTEX_SHADER, HARD_LIGHT_VERTEX_SHADER);
  const fragShader = createShader(
    gl.FRAGMENT_SHADER,
    HARD_LIGHT_FRAGMENT_SHADER,
  );
  if (!vertShader || !fragShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  // Setup full-screen quad geometry
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const quadVertices = new Float32Array([
    -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(program, "aPosition");
  const uniforms = {
    uResolution: gl.getUniformLocation(program, "uResolution"),
    uPointer: gl.getUniformLocation(program, "uPointer"),
    uTime: gl.getUniformLocation(program, "uTime"),
    uFacetScale: gl.getUniformLocation(program, "uFacetScale"),
    uRefractionIntensity: gl.getUniformLocation(
      program,
      "uRefractionIntensity",
    ),
  };

  return {
    program,
    uniforms,
    attributes: { aPosition },
    buffer,
  };
}
