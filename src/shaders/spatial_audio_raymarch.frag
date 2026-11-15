#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec3 uAudioSources[8]; // x, y: position (0..1), z: intensity in dBA
uniform int uSourceCount;
uniform vec4 uObstacles[8];   // x, y: start pos, z, w: end pos (wall segment)
uniform int uObstacleCount;

// Color gradient mapping based on dBA levels
// Blue: <40 dBA, Green: 40-55 dBA, Orange: 55-70 dBA, Crimson: >70 dBA
vec3 getAcousticColor(float dBA) {
    if (dBA < 40.0) {
        float t = clamp((dBA - 20.0) / 20.0, 0.0, 1.0);
        return mix(vec3(0.05, 0.1, 0.4), vec3(0.0, 0.6, 0.8), t); // Deep Blue to Cyan
    } else if (dBA < 55.0) {
        float t = clamp((dBA - 40.0) / 15.0, 0.0, 1.0);
        return mix(vec3(0.0, 0.6, 0.8), vec3(0.1, 0.75, 0.3), t); // Cyan to Green
    } else if (dBA < 70.0) {
        float t = clamp((dBA - 55.0) / 15.0, 0.0, 1.0);
        return mix(vec3(0.1, 0.75, 0.3), vec3(0.95, 0.55, 0.1), t); // Green to Orange
    } else {
        float t = clamp((dBA - 70.0) / 25.0, 0.0, 1.0);
        return mix(vec3(0.95, 0.55, 0.1), vec3(0.85, 0.05, 0.2), t); // Orange to Crimson
    }
}

// Distance from point p to line segment ab
float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// Ray-march to detect acoustic obstacle occlusion & shadow attenuation
float calculateShadowOcclusion(vec2 p, vec2 sourcePos) {
    float attenuation = 1.0;
    vec2 rayDir = normalize(p - sourcePos);
    float rayDist = length(p - sourcePos);
    
    // Check intersection with obstacles
    for (int i = 0; i < 8; i++) {
        if (i >= uObstacleCount) break;
        vec2 a = uObstacles[i].xy;
        vec2 b = uObstacles[i].zw;
        
        float d = distToSegment(p, a, b);
        if (d < 0.015) {
            // Point is directly inside an obstacle wall
            return 0.05;
        }

        // Ray casting wall intersection check
        vec2 v1 = sourcePos - a;
        vec2 v2 = b - a;
        vec2 v3 = vec2(-rayDir.y, rayDir.x);

        float dotVal = dot(v2, v3);
        if (abs(dotVal) > 0.0001) {
            float t1 = (v2.x * v1.y - v2.y * v1.x) / dotVal;
            float t2 = dot(v1, v3) / dotVal;
            if (t1 > 0.0 && t1 < rayDist && t2 >= 0.0 && t2 <= 1.0) {
                // Attenuate sound energy by 12 dBA per structural obstacle
                attenuation *= 0.25;
            }
        }
    }
    return attenuation;
}

void main() {
    vec2 st = gl_FragCoord.xy / uResolution.xy;
    float totalEnergy = 0.0;

    for (int i = 0; i < 8; i++) {
        if (i >= uSourceCount) break;
        vec2 srcPos = uAudioSources[i].xy;
        float srcPower = uAudioSources[i].z;

        float dist = max(length(st - srcPos), 0.05);
        
        // Inverse-square law attenuation
        float intensity = srcPower / (1.0 + 15.0 * dist * dist);
        
        // Apply wall shadow attenuation factor
        float shadow = calculateShadowOcclusion(st, srcPos);
        totalEnergy += intensity * shadow;
    }

    // Convert accumulated acoustic energy to dBA scale
    float dBA = clamp(totalEnergy, 20.0, 95.0);
    vec3 color = getAcousticColor(dBA);

    fragColor = vec4(color, 0.85);
}