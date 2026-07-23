#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_cloudCoverage;   // 0.0 to 1.0
uniform float u_humidity;        // 0.0 to 1.0
uniform float u_rainFactor;      // 0.0 to 1.0
uniform vec3 u_lightDir;         // Normalized direction to light source (sun/moon)
uniform vec3 u_lightColor;       // Color of sunlight/moonlight
uniform vec3 u_skyTopColor;      // Sky zenith color
uniform vec3 u_skyBottomColor;   // Sky horizon color
uniform float u_windSpeed;       // Wind movement multiplier
uniform int u_maxSteps;          // Adaptive raymarch step count (e.g., 32-64)
uniform float u_stepSize;        // Step length along ray

// --- Procedural 3D Simplex/Perlin Noise in GLSL ---
vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    // First corner
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    // Other corners
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
    vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

    // Permutations
    i = mod289(i);
    vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    // Gradients: 7x7 points over a square, mapped onto an octahedron.
    float n_ = 0.142857142857; // 1.0/7.0
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z);  // mod(p,7*7)

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);    // mod(j,N)

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

    // Normalise gradients
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    // Mix final noise value
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// 3D Fractional Brownian Motion (fBm)
float fbm(vec3 p) {
    float f = 0.0;
    float amp = 0.5;
    vec3 q = p;
    for (int i = 0; i < 4; i++) {
        f += amp * snoise(q);
        q = q * 2.02 + vec3(0.12, 0.34, 0.56);
        amp *= 0.5;
    }
    return f * 0.5 + 0.5; // Map from [-1, 1] to [0, 1]
}

// Sample cloud density in 3D volume
float sampleCloudDensity(vec3 pos) {
    vec3 windOffset = vec3(u_time * u_windSpeed * 0.05, 0.0, u_time * u_windSpeed * 0.02);
    vec3 samplePos = pos * 0.8 + windOffset;

    // Base cloud noise
    float noiseVal = fbm(samplePos);

    // Detail noise for soft edges
    float detail = fbm(samplePos * 2.5 + vec3(1.7, 9.2, 0.4));
    noiseVal = mix(noiseVal, detail, 0.35 * u_humidity);

    // Height gradient envelope (cloud slab between Y = 0.5 and Y = 2.5)
    float heightFraction = clamp((pos.y - 0.5) / 2.0, 0.0, 1.0);
    float heightEnvelope = smoothstep(0.0, 0.2, heightFraction) * smoothstep(1.0, 0.7, heightFraction);

    // Map cloud coverage to threshold
    float coverageThreshold = 1.0 - clamp(u_cloudCoverage * 0.95 + 0.05, 0.0, 1.0);
    float density = smoothstep(coverageThreshold, coverageThreshold + 0.35, noiseVal);

    // Darken/thicken density for rainy weather
    density *= heightEnvelope * mix(1.0, 2.2, u_rainFactor);
    return clamp(density, 0.0, 1.0);
}

// Henyey-Greenstein Phase Function for forward light scattering
float hgPhase(float cosAngle, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosAngle, 1.5));
}

void main() {
    vec2 st = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

    // Camera setup: Ray origin & direction looking up into atmosphere
    vec3 ro = vec3(0.0, 0.0, -1.5);
    vec3 rd = normalize(vec3(st.x, st.y + 0.45, 1.2));

    // Sky Background Gradient
    float skyGradientT = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyColor = mix(u_skyBottomColor, u_skyTopColor, skyGradientT);

    // Rain factor darkens sky
    skyColor *= mix(1.0, 0.45, u_rainFactor);

    // Volumetric cloud layer bounds (Y in [0.5, 2.5])
    float tMin = (0.5 - ro.y) / (rd.y + 0.0001);
    float tMax = (2.5 - ro.y) / (rd.y + 0.0001);

    if (tMin > tMax) {
        float tmp = tMin; tMin = tMax; tMax = tmp;
    }

    // Raymarching variables
    float transmittance = 1.0;
    vec3 accumulatedLight = vec3(0.0);

    float t = max(0.0, tMin);
    float tEnd = min(15.0, tMax);

    float stepSize = u_stepSize > 0.0 ? u_stepSize : (tEnd - t) / float(u_maxSteps);
    stepSize = clamp(stepSize, 0.05, 0.25);

    vec3 lightDir = normalize(u_lightDir);
    float cosAngle = dot(rd, lightDir);
    float phase = mix(hgPhase(cosAngle, 0.6), hgPhase(cosAngle, 0.2), u_rainFactor);

    // Cloud Base Color (darker for rain clouds, bright for sunny clouds)
    vec3 cloudBaseColor = mix(vec3(0.95, 0.96, 1.0), vec3(0.2, 0.22, 0.28), u_rainFactor);

    int stepsTaken = 0;
    for (int i = 0; i < 96; i++) {
        if (i >= u_maxSteps || t >= tEnd || transmittance < 0.01) {
            break;
        }

        vec3 pos = ro + rd * t;
        float density = sampleCloudDensity(pos);

        if (density > 0.001) {
            // Light sampling ray toward light source
            vec3 lightPos = pos + lightDir * 0.25;
            float lightDensity = sampleCloudDensity(lightPos);
            float lightAbsorption = exp(-lightDensity * 3.5);

            // Powder effect for soft silver linings
            float powder = 1.0 - exp(-density * 2.0);

            vec3 stepLight = u_lightColor * lightAbsorption * phase * powder * cloudBaseColor;

            // Ambient sky light contribution
            vec3 ambient = skyColor * 0.45;
            vec3 totalStepLight = stepLight + ambient;

            float stepTransmittance = exp(-density * stepSize * 4.0);
            accumulatedLight += (totalStepLight * (1.0 - stepTransmittance)) * transmittance;
            transmittance *= stepTransmittance;
        }

        t += stepSize;
        stepsTaken++;
    }

    float cloudAlpha = clamp(1.0 - transmittance, 0.0, 1.0);
    vec3 finalColor = mix(skyColor, accumulatedLight / max(cloudAlpha, 0.001), cloudAlpha);

    fragColor = vec4(finalColor, 1.0);
}
