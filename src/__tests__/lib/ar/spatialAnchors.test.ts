import {
  floorplanToARWorldCoordinates,
  arWorldToFloorplanCoordinates,
  getDefaultVenueDestinations,
  isSpatialAnchorSupported,
  createDestinationAnchor,
  updateAnchorPose,
  disposeSpatialAnchor,
  type WayfindingDestination,
  type VenueFloorplanCoordinate,
  type SpatialAnchor,
} from "@/lib/ar/spatialAnchors";
import { SCENE_SCALE, OFFSET_X, OFFSET_Z } from "@/lib/floorPlan";

describe("spatialAnchors Utility Library (#7233)", () => {
  describe("floorplanToARWorldCoordinates & arWorldToFloorplanCoordinates", () => {
    it("converts 2D floorplan coordinate to 3D metric AR world coordinate correctly", () => {
      // Test center point (OFFSET_X, OFFSET_Z) -> (0, defaultElevation, 0)
      const centerFloorplan: VenueFloorplanCoordinate = {
        x: OFFSET_X,
        y: OFFSET_Z,
      };

      const world = floorplanToARWorldCoordinates(centerFloorplan);
      expect(world.x).toBe(0);
      expect(world.y).toBe(0.5);
      expect(world.z).toBe(0);
    });

    it("applies scale factor accurately", () => {
      const coord: VenueFloorplanCoordinate = {
        x: OFFSET_X + 100, // +100 units * 0.05 = +5m
        y: OFFSET_Z - 50, // -50 units * 0.05 = -2.5m
      };

      const world = floorplanToARWorldCoordinates(coord);
      expect(world.x).toBe(5);
      expect(world.y).toBe(0.5);
      expect(world.z).toBe(-2.5);
    });

    it("accurately inverts AR world coordinates back into 2D floorplan coordinates", () => {
      const initialCoord: VenueFloorplanCoordinate = {
        x: 120,
        y: 350,
      };

      const world = floorplanToARWorldCoordinates(initialCoord);
      const convertedBack = arWorldToFloorplanCoordinates(world);

      expect(convertedBack.x).toBeCloseTo(initialCoord.x, 1);
      expect(convertedBack.y).toBeCloseTo(initialCoord.y, 1);
    });

    it("handles custom calibration offsets and rotations", () => {
      const calibration = {
        originX: 2.0,
        originY: 0.2,
        originZ: -1.0,
        rotationY: Math.PI / 2, // 90 degree rotation
        scale: SCENE_SCALE,
      };

      const coord: VenueFloorplanCoordinate = {
        x: OFFSET_X + 100, // +5m along unrotated X
        y: OFFSET_Z,
      };

      const world = floorplanToARWorldCoordinates(coord, calibration, 0.5);
      // With 90 deg rotation around Y: unrotated (5, 0) -> rotX = 5*cos(90) = 0, rotZ = 5*sin(90) = 5
      expect(world.x).toBeCloseTo(2.0, 2);
      expect(world.y).toBeCloseTo(0.7, 2); // 0.2 + 0.5
      expect(world.z).toBeCloseTo(4.0, 2); // 5 + (-1)

      const inverted = arWorldToFloorplanCoordinates(world, calibration);
      expect(inverted.x).toBeCloseTo(coord.x, 1);
      expect(inverted.y).toBeCloseTo(coord.y, 1);
    });

    it("throws an error when invalid coordinates are passed", () => {
      expect(() =>
        floorplanToARWorldCoordinates({ x: NaN, y: 10 }),
      ).toThrow("Invalid floorplan coordinate provided");

      expect(() =>
        arWorldToFloorplanCoordinates({ x: 0, y: 0, z: NaN }),
      ).toThrow("Invalid AR world coordinate provided");
    });
  });

  describe("getDefaultVenueDestinations", () => {
    it("returns destinations covering restrooms, quiet booths, and power outlets", () => {
      const destinations = getDefaultVenueDestinations();

      expect(destinations.length).toBeGreaterThan(0);

      const restrooms = destinations.filter((d) => d.category === "restroom");
      const booths = destinations.filter((d) => d.category === "quiet_booth");
      const outlets = destinations.filter((d) => d.category === "power_outlet");

      expect(restrooms.length).toBeGreaterThanOrEqual(1);
      expect(booths.length).toBeGreaterThanOrEqual(1);
      expect(outlets.length).toBeGreaterThanOrEqual(1);

      // Verify that active destinations have resolved 3D world positions
      expect(restrooms[0].worldPosition).toBeDefined();
      expect(typeof restrooms[0].worldPosition?.x).toBe("number");
      expect(typeof restrooms[0].worldPosition?.z).toBe("number");
    });

    it("flags unmapped destinations gracefully with isAvailable=false and undefined worldPosition", () => {
      const destinations = getDefaultVenueDestinations();
      const unmapped = destinations.find((d) => !d.isAvailable);
      expect(unmapped).toBeDefined();
      expect(unmapped?.worldPosition).toBeUndefined();
    });
  });

  describe("isSpatialAnchorSupported", () => {
    it("returns true when requestAnchor or createAnchor is present on session", () => {
      expect(isSpatialAnchorSupported({ requestAnchor: jest.fn() })).toBe(true);
      expect(isSpatialAnchorSupported({ createAnchor: jest.fn() })).toBe(true);
      expect(
        isSpatialAnchorSupported({ enabledFeatures: ["anchors", "local"] }),
      ).toBe(true);
    });

    it("returns false when session lacks anchor support or is null", () => {
      expect(isSpatialAnchorSupported(null)).toBe(false);
      expect(isSpatialAnchorSupported({})).toBe(false);
      expect(isSpatialAnchorSupported({ enabledFeatures: ["local"] })).toBe(false);
    });
  });

  describe("createDestinationAnchor & updateAnchorPose & disposeSpatialAnchor", () => {
    it("creates persistent WebXR anchor when session supports requestAnchor", async () => {
      const mockAnchor = {
        anchorSpace: {
          getTransform: jest.fn(),
        },
        delete: jest.fn(),
      };
      const mockSession = {
        requestAnchor: jest.fn().mockResolvedValue(mockAnchor),
      };
      const mockRefSpace = {};

      const destination: WayfindingDestination = {
        id: "dest-1",
        name: "Test Restroom",
        category: "restroom",
        worldPosition: { x: 1.5, y: 0.5, z: -3.0 },
        isAvailable: true,
      };

      const anchor = await createDestinationAnchor(
        mockSession,
        mockRefSpace,
        destination,
      );

      expect(anchor.trackingMode).toBe("persistent-webxr");
      expect(anchor.position).toEqual(destination.worldPosition);
      expect(anchor.xrAnchor).toBe(mockAnchor);
      expect(mockSession.requestAnchor).toHaveBeenCalledWith(
        { x: 1.5, y: 0.5, z: -3.0 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    });

    it("falls back to session-local anchor when requestAnchor throws or is unsupported", async () => {
      const mockSession = {
        requestAnchor: jest.fn().mockRejectedValue(new Error("Anchors not enabled")),
      };
      const mockRefSpace = {};

      const destination: WayfindingDestination = {
        id: "dest-2",
        name: "Test Booth",
        category: "quiet_booth",
        worldPosition: { x: -2.0, y: 0.5, z: 4.0 },
        isAvailable: true,
      };

      const anchor = await createDestinationAnchor(
        mockSession,
        mockRefSpace,
        destination,
      );

      expect(anchor.trackingMode).toBe("session-local");
      expect(anchor.position).toEqual(destination.worldPosition);
      expect(anchor.matrix).toHaveLength(16);
    });

    it("throws error when attempting to anchor destination without coordinates", async () => {
      const destination: WayfindingDestination = {
        id: "dest-unmapped",
        name: "Unmapped Room",
        category: "power_outlet",
        isAvailable: false,
      };

      await expect(
        createDestinationAnchor({}, {}, destination),
      ).rejects.toThrow("does not have resolved spatial coordinates");
    });

    it("updates anchor pose from XRFrame getPose when trackingMode is persistent-webxr", () => {
      const mockAnchorObj = {
        anchorSpace: {},
      };
      const initialAnchor: SpatialAnchor = {
        id: "test-anchor",
        destinationId: "dest-1",
        trackingMode: "persistent-webxr",
        position: { x: 1, y: 0, z: 1 },
        matrix: new Float32Array(16),
        xrAnchor: mockAnchorObj,
        createdAt: 1000,
        lastUpdated: 1000,
      };

      const mockPose = {
        transform: {
          position: { x: 1.2, y: 0.1, z: 1.1 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          matrix: new Float32Array(16),
        },
      };

      const mockFrame = {
        getPose: jest.fn().mockReturnValue(mockPose),
      };

      const updated = updateAnchorPose(initialAnchor, mockFrame, {});
      expect(updated.position).toEqual({ x: 1.2, y: 0.1, z: 1.1 });
      expect(mockFrame.getPose).toHaveBeenCalled();
    });

    it("disposes spatial anchor cleanly", () => {
      const deleteFn = jest.fn();
      const anchor: SpatialAnchor = {
        id: "test-anchor",
        destinationId: "dest-1",
        trackingMode: "persistent-webxr",
        position: { x: 0, y: 0, z: 0 },
        matrix: new Float32Array(16),
        xrAnchor: { delete: deleteFn },
        createdAt: 1000,
        lastUpdated: 1000,
      };

      disposeSpatialAnchor(anchor);
      expect(deleteFn).toHaveBeenCalledTimes(1);

      // Should not throw on null / undefined
      expect(() => disposeSpatialAnchor(null)).not.toThrow();
    });
  });
});
