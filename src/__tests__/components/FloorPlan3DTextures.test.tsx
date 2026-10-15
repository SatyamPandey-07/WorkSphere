import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import {
  FloorPlan3D,
  KTX2TextureLoader,
  configureKTX2Loader,
} from "@/components/venue/floorplan/FloorPlan3D";
import type { FloorPlanData } from "@/lib/webgpu/floorPlanRenderer";

// Mock WebGPUFloorPlanRenderer
jest.mock("@/lib/webgpu/floorPlanRenderer", () => {
  return {
    WebGPUFloorPlanRenderer: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(false),
      setPanBounds: jest.fn(),
      loadFloorPlanMesh: jest.fn(),
      startRenderLoop: jest.fn(),
      stopRenderLoop: jest.fn(),
      destroy: jest.fn(),
      camera: { distance: 8 },
    })),
  };
});

describe("FloorPlan3D KTX2 / Basis Universal Texture Streaming", () => {
  const sampleData: FloorPlanData = {
    width: 20,
    depth: 15,
    height: 4,
    seats: [
      {
        id: "seat-1",
        label: "D1",
        type: "hot_desk",
        x: 2,
        y: 0,
        z: 3,
        hasPower: true,
        isQuiet: false,
      },
    ],
  };

  describe("KTX2TextureLoader Web Worker Transcoder Pool", () => {
    it("configures default transcoder path and worker pool limit", () => {
      const loader = configureKTX2Loader();
      expect(loader.transcoderPath).toBe("/basis/");
      expect(loader.workerLimit).toBeGreaterThanOrEqual(1);
    });

    it("allows customizing transcoder path and worker pool size", () => {
      const loader = configureKTX2Loader({
        transcoderPath: "/custom-transcoder/",
        workerLimit: 4,
      });
      expect(loader.transcoderPath).toBe("/custom-transcoder/");
      expect(loader.workerLimit).toBe(4);

      loader.setTranscoderPath("/new-path/").setWorkerLimit(2);
      expect(loader.transcoderPath).toBe("/new-path/");
      expect(loader.workerLimit).toBe(2);
    });

    it("detects GPU compressed texture support via WebGL extensions", () => {
      const loader = new KTX2TextureLoader();

      const mockGlWithAstc = {
        getExtension: jest.fn((ext: string) => {
          if (ext === "WEBGL_compressed_texture_astc") return {};
          return null;
        }),
      } as unknown as WebGLRenderingContext;

      expect(loader.detectSupport(mockGlWithAstc)).toBe(true);

      const mockGlWithoutExtensions = {
        getExtension: jest.fn().mockReturnValue(null),
      } as unknown as WebGLRenderingContext;

      expect(loader.detectSupport(mockGlWithoutExtensions)).toBe(false);
      expect(loader.detectSupport(null)).toBe(false);
    });

    it("loads KTX2 textures with Web Worker transcoding when supported", async () => {
      const loader = new KTX2TextureLoader();
      const mockGl = {
        getExtension: jest.fn().mockReturnValue({}),
      } as unknown as WebGLRenderingContext;

      const result = await loader.load(
        "/textures/venues/venue-1-floor.ktx2",
        "/textures/venues/venue-1-floor.jpg",
        mockGl,
      );

      expect(result.isCompressed).toBe(true);
      expect(result.format).toBe("ktx2");
      expect(result.transcodedWithWorker).toBe(true);
      expect(result.source).toBe("/textures/venues/venue-1-floor.ktx2");
    });

    it("gracefully falls back to standard textures if KTX2 is unsupported", async () => {
      const loader = new KTX2TextureLoader();
      const mockGlWithoutSupport = {
        getExtension: jest.fn().mockReturnValue(null),
      } as unknown as WebGLRenderingContext;

      const result = await loader.load(
        "/textures/venues/venue-1-floor.ktx2",
        "/textures/venues/venue-1-floor.jpg",
        mockGlWithoutSupport,
      );

      expect(result.isCompressed).toBe(false);
      expect(result.format).toBe("standard");
      expect(result.transcodedWithWorker).toBe(false);
      expect(result.source).toBe("/textures/venues/venue-1-floor.jpg");
    });

    it("handles standard PNG/JPEG textures without compression", async () => {
      const loader = new KTX2TextureLoader();
      const result = await loader.load("/textures/venues/standard-wall.png");

      expect(result.isCompressed).toBe(false);
      expect(result.format).toBe("standard");
      expect(result.source).toBe("/textures/venues/standard-wall.png");
    });

    it("cleans up worker pool upon dispose", () => {
      const loader = new KTX2TextureLoader();
      expect(() => loader.dispose()).not.toThrow();
    });
  });

  describe("FloorPlan3D Component Integration", () => {
    it("renders floorplan with KTX2 texture streaming enabled by default", async () => {
      render(<FloorPlan3D venueId="venue-123" data={sampleData} />);

      expect(screen.getByText(/3D Floor Plan/i)).toBeInTheDocument();
      expect(screen.getByText(/1 seats/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(
          screen.getByText(/KTX2\/Basis Universal|Standard Textures/i),
        ).toBeInTheDocument();
      });
    });

    it("falls back to standard textures when enableKTX2 is false", async () => {
      render(
        <FloorPlan3D
          venueId="venue-123"
          data={sampleData}
          enableKTX2={false}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/Standard Textures/i)).toBeInTheDocument();
      });
    });

    it("accepts custom texture URLs", () => {
      render(
        <FloorPlan3D
          venueId="venue-123"
          data={sampleData}
          floorTextureUrl="/custom-floor.ktx2"
          wallTextureUrl="/custom-wall.ktx2"
        />,
      );

      expect(screen.getByText(/3D Floor Plan/i)).toBeInTheDocument();
    });
  });
});
