/**
 * WebGL 2.0 Gaussian Blur Multi-Pass Depth-of-Field GLSL ES 3.00 Shaders.
 *
 * Implements a separable, two-pass Gaussian blur depth-of-field post-processing pipeline:
 * - Fullscreen quad vertex shader
 * - Horizontal Gaussian blur fragment shader with depth-dependent CoC calculation
 * - Vertical Gaussian blur fragment shader with depth-dependent CoC modulation and blend
 */

export const DOF_VERTEX_SHADER = `#version 300 es
precision highp float;

// Fullscreen quad [-1, 1] positions
in vec2 a_position;

out vec2 v_uv;

void main() {
    v_uv = (a_position + 1.0) * 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Common GLSL ES 3.00 helper routines for Circle of Confusion (CoC)
 * and linear eye depth reconstruction from depth buffer values.
 */
export const DOF_COMMON_GLSL = `
// Reconstruct linear eye-space depth (positive distance in front of camera) from non-linear depth buffer [0, 1]
float linearizeDepth(float depthSample, float near, float far) {
    // Standard perspective depth: z_ndc = depthSample * 2.0 - 1.0;
    // z_eye = (2.0 * near * far) / (far + near - z_ndc * (far - near));
    // When depth is 1.0 (sky / background clearance), clamp to far plane safely
    if (depthSample >= 0.999999) {
        return far;
    }
    float z_ndc = depthSample * 2.0 - 1.0;
    float denom = far + near - z_ndc * (far - near);
    if (abs(denom) < 1e-6) {
        return far;
    }
    float linearDepth = (2.0 * near * far) / denom;
    return clamp(linearDepth, near, far);
}

/**
 * Thin-lens Circle of Confusion (CoC) formula:
 *   c = abs(A * (f * (z - s)) / (z * (s - f)))
 * where:
 *   A = aperture size (lens diameter, in mm or world units)
 *   f = focal length
 *   s = focus distance (distance to subject in sharp focus)
 *   z = actual linear eye depth of current fragment
 *
 * Returns normalized CoC in pixels [0, maxBlurRadius].
 */
float computeCircleOfConfusion(
    float linearZ,
    float focusDist,
    float focalLen,
    float aperture,
    float maxRadius
) {
    if (linearZ <= 0.0 || focusDist <= 0.0) {
        return 0.0;
    }
    float sMinusF = focusDist - focalLen;
    if (abs(sMinusF) < 1e-4) {
        sMinusF = 1e-4;
    }

    // CoC size on sensor plane
    float coc = abs(aperture * (focalLen * (linearZ - focusDist)) / (linearZ * sMinusF));
    
    // Scale CoC to screen pixel radius, clamped to max allowable kernel radius
    return clamp(coc, 0.0, maxRadius);
}
`;

/**
 * Pass 1: Horizontal Gaussian Blur Fragment Shader
 * Input:
 *   u_colorTexture (Scene color)
 *   u_depthTexture (Scene depth [0, 1])
 * Output:
 *   fragColor: vec4(blurredRGB, centerCoC)
 */
export const DOF_HORIZONTAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_colorTexture;
uniform sampler2D u_depthTexture;

uniform vec2 u_resolution;
uniform float u_focalLength;
uniform float u_apertureSize;
uniform float u_focusDistance;
uniform float u_nearPlane;
uniform float u_farPlane;
uniform float u_maxBlurRadius;
uniform int u_hasDepthTexture; // 1 if depth texture attached, 0 if unavailable

out vec4 fragColor;

${DOF_COMMON_GLSL}

void main() {
    vec4 centerColor = texture(u_colorTexture, v_uv);

    // If depth texture is missing/disabled, pass through untouched scene color
    if (u_hasDepthTexture == 0) {
        fragColor = vec4(centerColor.rgb, 0.0);
        return;
    }

    float depthSample = texture(u_depthTexture, v_uv).r;
    float linearZ = linearizeDepth(depthSample, u_nearPlane, u_farPlane);
    float centerCoC = computeCircleOfConfusion(linearZ, u_focusDistance, u_focalLength, u_apertureSize, u_maxBlurRadius);

    // If fragment is in sharp focus, skip horizontal convolution
    if (centerCoC < 0.1) {
        fragColor = vec4(centerColor.rgb, centerCoC);
        return;
    }

    vec2 texelSize = 1.0 / u_resolution;
    vec2 dir = vec2(texelSize.x, 0.0);

    // 9-tap 1D Gaussian kernel weights & offsets
    // Weights normalized to sum = 1.0
    const float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

    vec3 accumColor = centerColor.rgb * weights[0];
    float accumWeight = weights[0];

    for (int i = 1; i < 5; i++) {
        float offset = float(i) * (centerCoC / 4.0);
        vec2 uvOffset = dir * offset;

        // Positive sample
        vec2 uvPos = clamp(v_uv + uvOffset, vec2(0.0), vec2(1.0));
        vec4 colorPos = texture(u_colorTexture, uvPos);
        float depthPos = texture(u_depthTexture, uvPos).r;
        float zPos = linearizeDepth(depthPos, u_nearPlane, u_farPlane);
        float cocPos = computeCircleOfConfusion(zPos, u_focusDistance, u_focalLength, u_apertureSize, u_maxBlurRadius);

        // Bilateral-like depth weighting to prevent foreground background bleeding
        float weightPos = weights[i] * clamp(cocPos / max(centerCoC, 1e-4), 0.1, 1.0);
        accumColor += colorPos.rgb * weightPos;
        accumWeight += weightPos;

        // Negative sample
        vec2 uvNeg = clamp(v_uv - uvOffset, vec2(0.0), vec2(1.0));
        vec4 colorNeg = texture(u_colorTexture, uvNeg);
        float depthNeg = texture(u_depthTexture, uvNeg).r;
        float zNeg = linearizeDepth(depthNeg, u_nearPlane, u_farPlane);
        float cocNeg = computeCircleOfConfusion(zNeg, u_focusDistance, u_focalLength, u_apertureSize, u_maxBlurRadius);

        float weightNeg = weights[i] * clamp(cocNeg / max(centerCoC, 1e-4), 0.1, 1.0);
        accumColor += colorNeg.rgb * weightNeg;
        accumWeight += weightNeg;
    }

    vec3 resultRGB = (accumWeight > 1e-4) ? (accumColor / accumWeight) : centerColor.rgb;
    fragColor = vec4(resultRGB, centerCoC);
}
`;

/**
 * Pass 2: Vertical Gaussian Blur & Circle of Confusion Composite Fragment Shader
 * Input:
 *   u_intermediateTexture: Output of Pass 1 (blurred horizontally, alpha = CoC)
 *   u_colorTexture: Original sharp scene color
 *   u_depthTexture: Scene depth [0, 1]
 * Output:
 *   Final post-processed RGB color
 */
export const DOF_VERTICAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_intermediateTexture;
uniform sampler2D u_colorTexture;
uniform sampler2D u_depthTexture;

uniform vec2 u_resolution;
uniform float u_focalLength;
uniform float u_apertureSize;
uniform float u_focusDistance;
uniform float u_nearPlane;
uniform float u_farPlane;
uniform float u_maxBlurRadius;
uniform int u_hasDepthTexture;

out vec4 fragColor;

${DOF_COMMON_GLSL}

void main() {
    vec4 interColor = texture(u_intermediateTexture, v_uv);
    vec4 sharpColor = texture(u_colorTexture, v_uv);

    if (u_hasDepthTexture == 0) {
        fragColor = sharpColor;
        return;
    }

    float depthSample = texture(u_depthTexture, v_uv).r;
    float linearZ = linearizeDepth(depthSample, u_nearPlane, u_farPlane);
    float centerCoC = computeCircleOfConfusion(linearZ, u_focusDistance, u_focalLength, u_apertureSize, u_maxBlurRadius);

    // If completely sharp, output original sharp color directly
    if (centerCoC < 0.1) {
        fragColor = sharpColor;
        return;
    }

    vec2 texelSize = 1.0 / u_resolution;
    vec2 dir = vec2(0.0, texelSize.y);

    const float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

    vec3 accumColor = interColor.rgb * weights[0];
    float accumWeight = weights[0];

    for (int i = 1; i < 5; i++) {
        float offset = float(i) * (centerCoC / 4.0);
        vec2 uvOffset = dir * offset;

        // Positive sample
        vec2 uvPos = clamp(v_uv + uvOffset, vec2(0.0), vec2(1.0));
        vec4 samplePos = texture(u_intermediateTexture, uvPos);
        float cocPos = samplePos.a;
        float weightPos = weights[i] * clamp(cocPos / max(centerCoC, 1e-4), 0.1, 1.0);
        accumColor += samplePos.rgb * weightPos;
        accumWeight += weightPos;

        // Negative sample
        vec2 uvNeg = clamp(v_uv - uvOffset, vec2(0.0), vec2(1.0));
        vec4 sampleNeg = texture(u_intermediateTexture, uvNeg);
        float cocNeg = sampleNeg.a;
        float weightNeg = weights[i] * clamp(cocNeg / max(centerCoC, 1e-4), 0.1, 1.0);
        accumColor += sampleNeg.rgb * weightNeg;
        accumWeight += weightNeg;
    }

    vec3 blurredRGB = (accumWeight > 1e-4) ? (accumColor / accumWeight) : interColor.rgb;

    // Blend between sharp and blurred according to CoC factor to avoid abrupt transition halos
    float blendFactor = clamp(centerCoC / max(1.0, u_maxBlurRadius * 0.25), 0.0, 1.0);
    vec3 finalRGB = mix(sharpColor.rgb, blurredRGB, blendFactor);

    fragColor = vec4(finalRGB, sharpColor.a);
}
`;
