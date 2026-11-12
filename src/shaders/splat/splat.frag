#version 300 es
precision highp float;

in vec2 v_quadPos;
in vec3 v_color;
in float v_opacity;

out vec4 fragColor;

void main() {
    // Calculate Gaussian weight based on distance from center of the quad
    float d = dot(v_quadPos, v_quadPos);
    
    // Discard fragments outside the 3-sigma radius for performance
    if (d > 1.0) discard;
    
    float power = -0.5 * d;
    float alpha = exp(power) * v_opacity;
    
    // Premultiplied alpha output for correct blending
    fragColor = vec4(v_color * alpha, alpha);
}
