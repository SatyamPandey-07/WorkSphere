"use client";

import React, { useEffect, useRef } from "react";

const VS_SOURCE = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}`;

// Fallback embedded fragment shader string for WebGL 2.0 compilation
const FS_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec3 uAudioSources[8];
uniform int uSourceCount;

vec3 getAcousticColor(float dBA) {
    if (dBA < 40.0) return mix(vec3(0.05, 0.1, 0.4), vec3(0.0, 0.6, 0.8), clamp((dBA - 20.0) / 20.0, 0.0, 1.0));
    if (dBA < 55.0) return mix(vec3(0.0, 0.6, 0.8), vec3(0.1, 0.75, 0.3), clamp((dBA - 40.0) / 15.0, 0.0, 1.0));
    if (dBA < 70.0) return mix(vec3(0.1, 0.75, 0.3), vec3(0.95, 0.55, 0.1), clamp((dBA - 55.0) / 15.0, 0.0, 1.0));
    return mix(vec3(0.95, 0.55, 0.1), vec3(0.85, 0.05, 0.2), clamp((dBA - 70.0) / 25.0, 0.0, 1.0));
}

void main() {
    vec2 st = gl_FragCoord.xy / uResolution.xy;
    float totalEnergy = 0.0;
    for (int i = 0; i < uSourceCount; i++) {
        vec2 srcPos = uAudioSources[i].xy;
        float srcPower = uAudioSources[i].z;
        float dist = max(length(st - srcPos), 0.05);
        totalEnergy += srcPower / (1.0 + 15.0 * dist * dist);
    }
    float dBA = clamp(totalEnergy, 20.0, 95.0);
    fragColor = vec4(getAcousticColor(dBA), 0.75);
}`;

export const SpatialAudioHeatmap: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2");
    if (!gl) {
      console.warn("WebGL 2.0 not supported for SpatialAudioHeatmap.");
      return;
    }

    // Compile Vertex Shader
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VS_SOURCE);
    gl.compileShader(vs);

    // Compile Fragment Shader
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FS_SOURCE);
    gl.compileShader(fs);

    // Create & Link Program
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Quad Geometry
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const resLoc = gl.getUniformLocation(program, "uResolution");
    const srcCountLoc = gl.getUniformLocation(program, "uSourceCount");
    const sourcesLoc = gl.getUniformLocation(program, "uAudioSources");

    // Pass sample audio sources (x, y, dBA intensity)
    const audioSources = [
      0.25, 0.35, 78.0, // Coffee machine / lounge
      0.75, 0.65, 52.0, // Open desk cluster
    ];

    let animFrameId: number;

    const render = () => {
      if (!canvas) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform1i(srcCountLoc, 2);
      gl.uniform3fv(sourcesLoc, new Float32Array(audioSources));

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameId);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-xl overflow-hidden border border-zinc-800">
      <canvas
        ref={canvasRef}
        width={800}
        height={500}
        className="w-full h-full object-cover"
      />
    </div>
  );
};

export default SpatialAudioHeatmap;