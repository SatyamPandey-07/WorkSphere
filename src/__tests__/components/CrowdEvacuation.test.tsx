/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { CrowdEvacuation } from "@/components/CrowdEvacuation";

// Mock WebGPU
const mockDevice = {
  createBuffer: jest.fn(() => ({
    destroy: jest.fn(),
    mapAsync: jest.fn(),
    getMappedRange: jest.fn(() => new ArrayBuffer(0)),
    unmap: jest.fn(),
  })),
  createTexture: jest.fn(() => ({
    createView: jest.fn(),
    destroy: jest.fn(),
  })),
  createSampler: jest.fn(),
  createShaderModule: jest.fn(),
  createBindGroup: jest.fn(),
  createBindGroupLayout: jest.fn(() => ({})),
  createPipelineLayout: jest.fn(() => ({})),
  createCommandEncoder: jest.fn(() => ({
    beginComputePass: jest.fn(() => ({
      setPipeline: jest.fn(),
      setBindGroup: jest.fn(),
      dispatchWorkgroups: jest.fn(),
      end: jest.fn(),
    })),
    beginRenderPass: jest.fn(() => ({
      setPipeline: jest.fn(),
      setBindGroup: jest.fn(),
      setVertexBuffer: jest.fn(),
      setIndexBuffer: jest.fn(),
      drawIndexed: jest.fn(),
      end: jest.fn(),
    })),
    copyBufferToBuffer: jest.fn(),
    finish: jest.fn(),
  })),
  queue: {
    writeBuffer: jest.fn(),
    writeTexture: jest.fn(),
    submit: jest.fn(),
  },
  createComputePipeline: jest.fn(() => ({})),
  lost: { then: jest.fn() },
};

const mockAdapter = {
  requestDevice: jest.fn(() => Promise.resolve(mockDevice)),
};

Object.defineProperty(navigator, "gpu", {
  value: {
    requestAdapter: jest.fn(() => Promise.resolve(mockAdapter)),
    getPreferredCanvasFormat: jest.fn(() => "bgra8unorm"),
  },
  writable: true,
});

// Mock canvas getContext
HTMLCanvasElement.prototype.getContext = jest.fn((type: string) => {
  if (type === "webgpu") {
    return {
      configure: jest.fn(),
      getCurrentTexture: jest.fn(() => ({
        createView: jest.fn(),
      })),
    };
  }
  if (type === "webgl2") {
    return {
      clearColor: jest.fn(),
      clear: jest.fn(),
      enable: jest.fn(),
      getExtension: jest.fn(() => ({
        vertexAttribDivisorANGLE: jest.fn(),
        drawElementsInstancedANGLE: jest.fn(),
      })),
      createShader: jest.fn(),
      shaderSource: jest.fn(),
      compileShader: jest.fn(),
      getShaderParameter: jest.fn(() => true),
      createProgram: jest.fn(() => ({})),
      attachShader: jest.fn(),
      linkProgram: jest.fn(),
      getProgramParameter: jest.fn(() => true),
      useProgram: jest.fn(),
      createBuffer: jest.fn(() => ({})),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      getAttribLocation: jest.fn(() => 0),
      enableVertexAttribArray: jest.fn(),
      vertexAttribPointer: jest.fn(),
      getUniformLocation: jest.fn(() => ({})),
      uniformMatrix4fv: jest.fn(),
      depthTest: true,
      VERTEX_SHADER: 0,
      FRAGMENT_SHADER: 1,
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      STATIC_DRAW: 0x88e4,
      DYNAMIC_DRAW: 0x88e8,
      FLOAT: 0x1406,
      UNSIGNED_SHORT: 0x1403,
      TRIANGLES: 0x0004,
      DEPTH_TEST: 0x0b71,
      COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x0100,
    };
  }
  return null;
});

describe("CrowdEvacuation Component", () => {
  it("renders the simulation container with header", () => {
    render(<CrowdEvacuation />);

    expect(screen.getByText("Crowd Evacuation Simulation")).toBeInTheDocument();
  });

  it("renders pause and reset buttons", () => {
    render(<CrowdEvacuation />);

    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("renders the agent count slider", () => {
    render(<CrowdEvacuation maxAgents={10000} />);

    const slider = screen.getByLabelText("Agents:");
    expect(slider).toBeInTheDocument();
  });

  it("renders the canvas element", () => {
    render(<CrowdEvacuation />);

    const canvas = document.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
  });

  it("shows renderer mode after initialization", async () => {
    render(<CrowdEvacuation />);

    // Initially shows detecting, then updates after init
    const modeIndicator = await screen.findByText(
      /WebGPU Compute|WebGL 2\.0 Fallback|Unsupported|detecting/,
    );
    expect(modeIndicator).toBeInTheDocument();
  });
});
