/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { HeatDiffusionOverlay } from "@/components/venue/floorplan/HeatDiffusionOverlay";

Object.defineProperty(navigator, "gpu", {
  value: undefined,
  configurable: true,
});

HTMLCanvasElement.prototype.getContext = jest.fn((type: string) => {
  if (type === "webgl2") {
    return {
      createShader: jest.fn(() => ({})),
      shaderSource: jest.fn(),
      compileShader: jest.fn(),
      getShaderParameter: jest.fn(() => true),
      getShaderInfoLog: jest.fn(() => ""),
      deleteShader: jest.fn(),
      createProgram: jest.fn(() => ({})),
      attachShader: jest.fn(),
      linkProgram: jest.fn(),
      getProgramParameter: jest.fn(() => true),
      getProgramInfoLog: jest.fn(() => ""),
      createBuffer: jest.fn(() => ({})),
      createVertexArray: jest.fn(() => ({})),
      bindVertexArray: jest.fn(),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      getAttribLocation: jest.fn(() => 0),
      enableVertexAttribArray: jest.fn(),
      vertexAttribPointer: jest.fn(),
      createTexture: jest.fn(() => ({})),
      bindTexture: jest.fn(),
      texParameteri: jest.fn(),
      texImage2D: jest.fn(),
      enable: jest.fn(),
      blendFunc: jest.fn(),
      viewport: jest.fn(),
      clearColor: jest.fn(),
      clear: jest.fn(),
      useProgram: jest.fn(),
      activeTexture: jest.fn(),
      getUniformLocation: jest.fn(() => ({})),
      uniform1i: jest.fn(),
      uniform1f: jest.fn(),
      drawArrays: jest.fn(),
      deleteTexture: jest.fn(),
      deleteProgram: jest.fn(),
      deleteVertexArray: jest.fn(),
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS: 35713,
      LINK_STATUS: 35714,
      ARRAY_BUFFER: 34962,
      STATIC_DRAW: 35044,
      TEXTURE_2D: 3553,
      TEXTURE_MIN_FILTER: 10241,
      TEXTURE_MAG_FILTER: 10240,
      TEXTURE_WRAP_S: 10242,
      TEXTURE_WRAP_T: 10243,
      LINEAR: 9729,
      CLAMP_TO_EDGE: 33071,
      R32F: 33326,
      RED: 6403,
      FLOAT: 5126,
      TEXTURE0: 33984,
      BLEND: 3042,
      SRC_ALPHA: 770,
      ONE_MINUS_SRC_ALPHA: 771,
      COLOR_BUFFER_BIT: 16384,
      TRIANGLES: 4,
    };
  }
  return null;
}) as typeof HTMLCanvasElement.prototype.getContext;

describe("HeatDiffusionOverlay", () => {
  it("renders the thermal overlay chrome", async () => {
    render(<HeatDiffusionOverlay width={320} height={200} />);
    expect(screen.getByText(/Thermal Diffusion/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Venue temperature heatmap overlay/i),
    ).toBeInTheDocument();
  });

  it("exposes pause and reset controls", () => {
    render(<HeatDiffusionOverlay />);
    expect(screen.getByLabelText(/Pause simulation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reset simulation/i)).toBeInTheDocument();
  });
});
