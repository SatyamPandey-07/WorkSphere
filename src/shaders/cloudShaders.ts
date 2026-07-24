/**
 * Exported GLSL shader source code for WebGL 2 Volumetric Cloud Rendering.
 * Bundled as TypeScript string constants for Next.js / Webpack compatibility.
 */

export const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + vec2(0.5);
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_cloudCoverage;   // 0.0 to 1.0
uniform float u_humidity;        // 0.0 to 1.0
uniform float u_rainFactor;      // 0.0 to 1.0
uniform vec3 u_lightDir;         // Normalized direction to light source
uniform vec3 u_lightColor;       // Sunlight / Moonlight color
uniform vec3 u_skyTopColor;      // Sky zenith color
uniform vec3 u_skyBottomColor;   // Sky horizon color
uniform float u_windSpeed;       // Wind movement multiplier
uniform int u_maxSteps;          // Adaptive raymarch step count
uniform float u_stepSize;        // Raymarching step size

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
    float f = 0.0;
    float amp = 0.5;
    vec3 q = p;
    for (int i = 0; i < 4; i++) {
        f += amp * snoise(q);
        q = q * 2.02 + vec3(0.12, 0.34, 0.56);
        amp *= 0.5;
    }
    return f * 0.5 + 0.5;
}

float sampleCloudDensity(vec3 pos) {
    vec3 windOffset = vec3(u_time * u_windSpeed * 0.05, 0.0, u_time * u_windSpeed * 0.02);
    vec3 samplePos = pos * 0.8 + windOffset;

    float noiseVal = fbm(samplePos);
    float detail = fbm(samplePos * 2.5 + vec3(1.7, 9.2, 0.4));
    noiseVal = mix(noiseVal, detail, 0.35 * u_humidity);

    float heightFraction = clamp((pos.y - 0.5) / 2.0, 0.0, 1.0);
    float heightEnvelope = smoothstep(0.0, 0.2, heightFraction) * smoothstep(1.0, 0.7, heightFraction);

    float coverageThreshold = 1.0 - clamp(u_cloudCoverage * 0.95 + 0.05, 0.0, 1.0);
    float density = smoothstep(coverageThreshold, coverageThreshold + 0.35, noiseVal);

    density *= heightEnvelope * mix(1.0, 2.2, u_rainFactor);
    return clamp(density, 0.0, 1.0);
}

float hgPhase(float cosAngle, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosAngle, 1.5));
}

void main() {
    vec2 st = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

    vec3 ro = vec3(0.0, 0.0, -1.5);
    vec3 rd = normalize(vec3(st.x, st.y + 0.45, 1.2));

    float skyGradientT = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyColor = mix(u_skyBottomColor, u_skyTopColor, skyGradientT);
    skyColor *= mix(1.0, 0.45, u_rainFactor);

    float tMin = (0.5 - ro.y) / (rd.y + 0.0001);
    float tMax = (2.5 - ro.y) / (rd.y + 0.0001);

    if (tMin > tMax) {
        float tmp = tMin; tMin = tMax; tMax = tmp;
    }

    float transmittance = 1.0;
    vec3 accumulatedLight = vec3(0.0);

    float t = max(0.0, tMin);
    float tEnd = min(15.0, tMax);

    float stepSize = u_stepSize > 0.0 ? u_stepSize : (tEnd - t) / float(u_maxSteps);
    stepSize = clamp(stepSize, 0.05, 0.25);

    vec3 lightDir = normalize(u_lightDir);
    float cosAngle = dot(rd, lightDir);
    float phase = mix(hgPhase(cosAngle, 0.6), hgPhase(cosAngle, 0.2), u_rainFactor);

    vec3 cloudBaseColor = mix(vec3(0.95, 0.96, 1.0), vec3(0.2, 0.22, 0.28), u_rainFactor);

    for (int i = 0; i < 96; i++) {
        if (i >= u_maxSteps || t >= tEnd || transmittance < 0.01) {
            break;
        }

        vec3 pos = ro + rd * t;
        float density = sampleCloudDensity(pos);

        if (density > 0.001) {
            vec3 lightPos = pos + lightDir * 0.25;
            float lightDensity = sampleCloudDensity(lightPos);
            float lightAbsorption = exp(-lightDensity * 3.5);

            float powder = 1.0 - exp(-density * 2.0);

            vec3 stepLight = u_lightColor * lightAbsorption * phase * powder * cloudBaseColor;
            vec3 ambient = skyColor * 0.45;
            vec3 totalStepLight = stepLight + ambient;

            float stepTransmittance = exp(-density * stepSize * 4.0);
            accumulatedLight += (totalStepLight * (1.0 - stepTransmittance)) * transmittance;
            transmittance *= stepTransmittance;
        }

        t += stepSize;
    }

    float cloudAlpha = clamp(1.0 - transmittance, 0.0, 1.0);
    vec3 finalColor = mix(skyColor, accumulatedLight / max(cloudAlpha, 0.001), cloudAlpha);

    fragColor = vec4(finalColor, 1.0);
}
`;
