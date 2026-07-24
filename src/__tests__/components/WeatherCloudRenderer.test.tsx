import React from "react";
import { render, screen } from "@testing-library/react";
import { WeatherCloudRenderer } from "@/components/WeatherCloudRenderer";

// Mock canvas getContext for WebGL in JSDOM environment
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn((contextType: string) => {
    if (contextType === "webgl2" || contextType === "webgl") {
      return {
        createShader: jest.fn(() => ({})),
        shaderSource: jest.fn(),
        compileShader: jest.fn(),
        getShaderParameter: jest.fn(() => true),
        createProgram: jest.fn(() => ({})),
        attachShader: jest.fn(),
        linkProgram: jest.fn(),
        getProgramParameter: jest.fn(() => true),
        useProgram: jest.fn(),
        createVertexArray: jest.fn(() => ({})),
        createBuffer: jest.fn(() => ({})),
        bindVertexArray: jest.fn(),
        bindBuffer: jest.fn(),
        bufferData: jest.fn(),
        getAttribLocation: jest.fn(() => 0),
        enableVertexAttribArray: jest.fn(),
        vertexAttribPointer: jest.fn(),
        getUniformLocation: jest.fn(() => ({})),
        viewport: jest.fn(),
        uniform1f: jest.fn(),
        uniform1i: jest.fn(),
        uniform2f: jest.fn(),
        uniform3fv: jest.fn(),
        drawArrays: jest.fn(),
        deleteProgram: jest.fn(),
        deleteShader: jest.fn(),
        deleteBuffer: jest.fn(),
        deleteVertexArray: jest.fn(),
      } as unknown as WebGL2RenderingContext;
    }
    return null;
  }) as any;
});

describe("WeatherCloudRenderer Component", () => {
  test("renders 3D Volumetric Weather overlay badge", () => {
    render(
      <WeatherCloudRenderer
        lat={37.7749}
        lng={-122.4194}
        initialWeatherData={{
          cloudCover: 65,
          humidity: 70,
          weatherCondition: "partly_cloudy",
          temperature: 21,
        }}
        showOverlay={true}
      />,
    );

    expect(screen.getByText("3D Volumetric Weather")).toBeInTheDocument();
    expect(screen.getByText("partly cloudy")).toBeInTheDocument();
    expect(screen.getByText("65%")).toBeInTheDocument();
  });
});
