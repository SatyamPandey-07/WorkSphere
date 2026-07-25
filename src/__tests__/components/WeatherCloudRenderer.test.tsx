import React from "react";
import { render, screen } from "@testing-library/react";
import { WeatherCloudRenderer } from "@/components/WeatherCloudRenderer";
import * as weatherUtils from "@/utils/weatherToCloudDensity";

// ---------- WebGL 2 mock ----------
const glMock = {
  createShader: jest.fn(() => ({})),
  shaderSource: jest.fn(),
  compileShader: jest.fn(),
  getShaderParameter: jest.fn(() => true),
  getShaderInfoLog: jest.fn(() => ""),
  createProgram: jest.fn(() => ({})),
  attachShader: jest.fn(),
  linkProgram: jest.fn(),
  getProgramParameter: jest.fn(() => true),
  getProgramInfoLog: jest.fn(() => ""),
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
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  FLOAT: 0x1406,
  TRIANGLES: 0x0004,
};

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn((contextType: string) => {
    if (contextType === "webgl2" || contextType === "webgl") {
      return { ...glMock } as unknown as WebGL2RenderingContext;
    }
    return null;
  }) as any;
});

// ---------- Tests ----------

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

  test("displays correct humidity and wind speed stats", () => {
    render(
      <WeatherCloudRenderer
        initialWeatherData={{
          cloudCover: 80,
          humidity: 55,
          weatherCondition: "cloudy",
          temperature: 18,
          windSpeed: 25,
        }}
        showOverlay={true}
      />,
    );

    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.getByText("25 km/h")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  test("renders rainy condition icon label", () => {
    render(
      <WeatherCloudRenderer
        initialWeatherData={{
          cloudCover: 95,
          humidity: 90,
          weatherCondition: "rainy",
          temperature: 14,
          rainProbability: 80,
        }}
        showOverlay={true}
      />,
    );

    expect(screen.getByText("rainy")).toBeInTheDocument();
    expect(screen.getByText(/14°C/)).toBeInTheDocument();
  });

  test("shows fallback when WebGL 2 is unsupported", () => {
    // Override to return null for webgl2
    HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as any;

    render(
      <WeatherCloudRenderer
        initialWeatherData={{
          cloudCover: 50,
          humidity: 60,
          weatherCondition: "partly_cloudy",
          temperature: 20,
        }}
        showOverlay={true}
      />,
    );

    expect(screen.getByText("2D Weather Mode")).toBeInTheDocument();
    expect(screen.getByText("50% Cloud Cover")).toBeInTheDocument();

    // Restore mock
    HTMLCanvasElement.prototype.getContext = jest.fn((contextType: string) => {
      if (contextType === "webgl2" || contextType === "webgl") {
        return { ...glMock } as unknown as WebGL2RenderingContext;
      }
      return null;
    }) as any;
  });

  test("does not render overlay when showOverlay is false", () => {
    render(
      <WeatherCloudRenderer
        initialWeatherData={{
          cloudCover: 50,
          humidity: 60,
          weatherCondition: "clear",
          temperature: 28,
        }}
        showOverlay={false}
      />,
    );

    expect(screen.queryByText("3D Volumetric Weather")).not.toBeInTheDocument();
  });

  test("renders canvas element when WebGL 2 is available", () => {
    const { container } = render(
      <WeatherCloudRenderer
        initialWeatherData={{
          cloudCover: 30,
          humidity: 40,
          weatherCondition: "clear",
          temperature: 30,
        }}
      />,
    );

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
  });

  test("displays FPS counter when interactive is true", () => {
    render(
      <WeatherCloudRenderer
        initialWeatherData={{
          cloudCover: 45,
          humidity: 60,
          weatherCondition: "partly_cloudy",
          temperature: 22,
        }}
        showOverlay={true}
        interactive={true}
      />,
    );

    // The FPS badge renders as "{fps} FPS" – default fps state is 60
    expect(screen.getByText(/FPS/)).toBeInTheDocument();
  });

  test("hides FPS counter when interactive is false", () => {
    render(
      <WeatherCloudRenderer
        initialWeatherData={{
          cloudCover: 45,
          humidity: 60,
          weatherCondition: "partly_cloudy",
          temperature: 22,
        }}
        showOverlay={true}
        interactive={false}
      />,
    );

    expect(screen.queryByText(/FPS/)).not.toBeInTheDocument();
  });
});

describe("weatherToCloudUniforms", () => {
  test("returns default uniforms when no data is provided", () => {
    const uniforms = weatherUtils.weatherToCloudUniforms(null);
    expect(uniforms.cloudCoverage).toBeCloseTo(0.45);
    expect(uniforms.humidity).toBeCloseTo(0.6);
  });

  test("clamps coverage and humidity to [0,1]", () => {
    const uniforms = weatherUtils.weatherToCloudUniforms({
      cloudCover: 150,
      humidity: -20,
    });
    expect(uniforms.cloudCoverage).toBe(1.0);
    expect(uniforms.humidity).toBe(0.0);
  });

  test("returns stormy sky colors for stormy conditions", () => {
    const uniforms = weatherUtils.weatherToCloudUniforms({
      weatherCondition: "stormy",
      rainProbability: 90,
    });
    // Stormy skies have darkened light color
    expect(uniforms.lightColor[0]).toBeLessThan(0.5);
    expect(uniforms.skyTopColor[0]).toBeLessThan(0.2);
  });

  test("returns brighter colors for clear conditions", () => {
    const uniforms = weatherUtils.weatherToCloudUniforms({
      weatherCondition: "clear",
      cloudCover: 5,
      isDaytime: true,
    });
    expect(uniforms.lightColor[0]).toBeGreaterThanOrEqual(0.9);
    expect(uniforms.skyTopColor[2]).toBeGreaterThan(0.8);
  });

  test("adjusts lightDir for nighttime", () => {
    const day = weatherUtils.weatherToCloudUniforms({ isDaytime: true });
    const night = weatherUtils.weatherToCloudUniforms({ isDaytime: false });
    expect(day.lightDir).not.toEqual(night.lightDir);
    expect(night.lightDir[0]).toBeLessThan(0);
  });
});

describe("mapWMOCodeToCondition", () => {
  test("maps code 0 to clear", () => {
    expect(weatherUtils.mapWMOCodeToCondition(0)).toBe("clear");
  });

  test("maps codes 1-3 to partly_cloudy", () => {
    expect(weatherUtils.mapWMOCodeToCondition(1)).toBe("partly_cloudy");
    expect(weatherUtils.mapWMOCodeToCondition(3)).toBe("partly_cloudy");
  });

  test("maps codes 51-67 to rainy", () => {
    expect(weatherUtils.mapWMOCodeToCondition(51)).toBe("rainy");
    expect(weatherUtils.mapWMOCodeToCondition(67)).toBe("rainy");
  });

  test("maps codes 95-99 to stormy", () => {
    expect(weatherUtils.mapWMOCodeToCondition(95)).toBe("stormy");
    expect(weatherUtils.mapWMOCodeToCondition(99)).toBe("stormy");
  });

  test("maps fog codes to foggy", () => {
    expect(weatherUtils.mapWMOCodeToCondition(45)).toBe("foggy");
    expect(weatherUtils.mapWMOCodeToCondition(48)).toBe("foggy");
  });

  test("maps snow codes to snowy", () => {
    expect(weatherUtils.mapWMOCodeToCondition(71)).toBe("snowy");
    expect(weatherUtils.mapWMOCodeToCondition(77)).toBe("snowy");
  });

  test("defaults to cloudy for unknown codes", () => {
    expect(weatherUtils.mapWMOCodeToCondition(10)).toBe("cloudy");
  });
});
