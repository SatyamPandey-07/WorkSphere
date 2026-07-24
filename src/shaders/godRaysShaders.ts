/**
 * GLSL shader source code for WebGL 2.0 Volumetric Light Shaft (God Rays) rendering.
 * Radial blur post-processing effect with procedural noise perturbation.
 */

export const GOD_RAYS_VERTEX_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + vec2(0.5);
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const GOD_RAYS_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_sunPosition;
uniform float u_rayIntensity;
uniform float u_rayLength;
uniform float u_decay;
uniform float u_density;
uniform float u_weight;

const int NUM_SAMPLES = 32;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 texelSize = 1.0 / u_resolution;
    vec2 deltaTexCoord = (v_uv - u_sunPosition) * texelSize * u_density;

    vec2 sampleCoord = v_uv;
    float illumination = 0.0;
    float decay = 1.0;

    for (int i = 0; i < NUM_SAMPLES; i++) {
        sampleCoord -= deltaTexCoord;

        float n = noise(sampleCoord * 200.0 + u_time * 0.5) * 0.4 + 0.8;
        float sampleVal = n * u_weight;

        sampleVal *= decay * decay;
        illumination += sampleVal;
        decay *= u_decay;
    }

    illumination *= u_rayIntensity * u_rayLength;

    float sunDist = length(v_uv - u_sunPosition);
    float sunGlow = exp(-sunDist * 8.0) * 0.6;
    float sunHalo = exp(-sunDist * 3.0) * 0.15;

    vec3 rayColor = mix(
        vec3(1.0, 0.95, 0.8),
        vec3(1.0, 0.6, 0.2),
        clamp(sunDist * 2.0, 0.0, 1.0)
    );

    vec3 color = rayColor * illumination;
    color += vec3(1.0, 0.98, 0.9) * sunGlow;
    color += vec3(1.0, 0.9, 0.7) * sunHalo;

    float alpha = clamp(illumination + sunGlow + sunHalo, 0.0, 0.85);

    fragColor = vec4(color, alpha);
}
`;
