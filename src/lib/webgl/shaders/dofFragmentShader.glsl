/**
 * dofFragmentShader.glsl
 * WebGL 2.0 / GLSL ES 3.00 Horizontal Gaussian Blur Depth-of-Field Fragment Shader.
 */

#version 300 es
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
uniform int u_hasDepthTexture;

out vec4 fragColor;

float linearizeDepth(float depthSample, float near, float far) {
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
    float coc = abs(aperture * (focalLen * (linearZ - focusDist)) / (linearZ * sMinusF));
    return clamp(coc, 0.0, maxRadius);
}

void main() {
    vec4 centerColor = texture(u_colorTexture, v_uv);

    if (u_hasDepthTexture == 0) {
        fragColor = vec4(centerColor.rgb, 0.0);
        return;
    }

    float depthSample = texture(u_depthTexture, v_uv).r;
    float linearZ = linearizeDepth(depthSample, u_nearPlane, u_farPlane);
    float centerCoC = computeCircleOfConfusion(linearZ, u_focusDistance, u_focalLength, u_apertureSize, u_maxBlurRadius);

    if (centerCoC < 0.1) {
        fragColor = vec4(centerColor.rgb, centerCoC);
        return;
    }

    vec2 texelSize = 1.0 / u_resolution;
    vec2 dir = vec2(texelSize.x, 0.0);

    const float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

    vec3 accumColor = centerColor.rgb * weights[0];
    float accumWeight = weights[0];

    for (int i = 1; i < 5; i++) {
        float offset = float(i) * (centerCoC / 4.0);
        vec2 uvOffset = dir * offset;

        vec2 uvPos = clamp(v_uv + uvOffset, vec2(0.0), vec2(1.0));
        vec4 colorPos = texture(u_colorTexture, uvPos);
        float depthPos = texture(u_depthTexture, uvPos).r;
        float zPos = linearizeDepth(depthPos, u_nearPlane, u_farPlane);
        float cocPos = computeCircleOfConfusion(zPos, u_focusDistance, u_focalLength, u_apertureSize, u_maxBlurRadius);
        float weightPos = weights[i] * clamp(cocPos / max(centerCoC, 1e-4), 0.1, 1.0);
        accumColor += colorPos.rgb * weightPos;
        accumWeight += weightPos;

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
