/**
 * Spatial Anchor and Coordinate Transformation Utilities for WebXR Indoor AR Navigation
 * Issue #7233: feat(ar): build WebXR augmented reality indoor venue navigation with WebGL anchors
 */

import { SCENE_SCALE, OFFSET_X, OFFSET_Z } from "@/lib/floorPlan";
import { FLOOR_PLAN_ZONES, DEFAULT_FLOOR_PLAN_SEATS } from "@/components/venue/FloorPlanCanvas";

/** Supported wayfinding destination categories */
export type DestinationCategory = "restroom" | "quiet_booth" | "power_outlet";

/** Venue floorplan 2D coordinate representation */
export interface VenueFloorplanCoordinate {
  x: number;
  y: number;
  level?: number;
}

/** AR World 3D coordinate in metric WebXR coordinates (meters) */
export interface ARWorldCoordinate {
  x: number;
  y: number;
  z: number;
}

/** Wayfinding destination item definition */
export interface WayfindingDestination {
  id: string;
  category: DestinationCategory;
  name: string;
  floorplanCoord?: VenueFloorplanCoordinate;
  worldPosition?: ARWorldCoordinate;
  description?: string;
  zoneId?: string;
  isAvailable: boolean;
}

/** Spatial anchor tracking reference space mode */
export type AnchorTrackingMode = "persistent-webxr" | "session-local" | "reference-space-fallback";

/** Strongly typed representation of an active spatial anchor */
export interface SpatialAnchor {
  id: string;
  destinationId: string;
  trackingMode: AnchorTrackingMode;
  position: ARWorldCoordinate;
  orientation?: { x: number; y: number; z: number; w: number };
  matrix: Float32Array; // 4x4 column-major matrix
  xrAnchor?: any;
  createdAt: number;
  lastUpdated: number;
}

/** Calibration offset or origin alignment parameters between physical space and floorplan */
export interface SpatialCalibrationTransform {
  originX: number; // meters offset along X
  originY: number; // elevation offset in meters
  originZ: number; // meters offset along Z
  rotationY: number; // azimuth rotation around Y axis in radians
  scale: number; // scaling factor (defaults to SCENE_SCALE = 0.05)
}

/** Default 1:1 calibration transform aligned with floorPlan center origin */
export const DEFAULT_CALIBRATION: SpatialCalibrationTransform = {
  originX: 0,
  originY: 0,
  originZ: 0,
  rotationY: 0,
  scale: SCENE_SCALE,
};

/**
 * Standard venue wayfinding destinations resolved from existing floorplan data & layout zones.
 * Incorporates:
 * - Restroom (Venue facilities)
 * - Quiet booth (zone-booth / phone booths / quiet seats)
 * - Power outlet (seats with hasPowerSocket)
 */
export function getDefaultVenueDestinations(): WayfindingDestination[] {
  const destinations: WayfindingDestination[] = [];

  // 1. Restrooms (Facilities on the venue floorplan perimeter)
  destinations.push({
    id: "facility-restroom-north",
    category: "restroom",
    name: "North Restroom & Accessible WC",
    floorplanCoord: { x: 345, y: 30, level: 1 },
    worldPosition: floorplanToARWorldCoordinates({ x: 345, y: 30, level: 1 }),
    description: "ADA-compliant gender-neutral restroom with touchless facilities",
    isAvailable: true,
  });

  destinations.push({
    id: "facility-restroom-south",
    category: "restroom",
    name: "South Restroom",
    floorplanCoord: { x: 345, y: 440, level: 1 },
    worldPosition: floorplanToARWorldCoordinates({ x: 345, y: 440, level: 1 }),
    description: "Standard restrooms with water refill station nearby",
    isAvailable: true,
  });

  // 2. Quiet Booths (From FLOOR_PLAN_ZONES zone-booth / quiet zone)
  const boothZone = FLOOR_PLAN_ZONES.find((z) => z.id === "zone-booth");
  if (boothZone) {
    const centerX = boothZone.x + boothZone.width / 2;
    const centerY = boothZone.y + boothZone.height / 2;
    destinations.push({
      id: "zone-quiet-booth-collab",
      category: "quiet_booth",
      name: "Collaboration Acoustic Booth #1",
      floorplanCoord: { x: centerX - 100, y: centerY, level: 1 },
      worldPosition: floorplanToARWorldCoordinates({ x: centerX - 100, y: centerY, level: 1 }),
      description: "Soundproof single-occupancy booth with acoustic insulation",
      zoneId: "zone-booth",
      isAvailable: true,
    });
    destinations.push({
      id: "zone-quiet-booth-meeting",
      category: "quiet_booth",
      name: "Focus Audio Pod #2",
      floorplanCoord: { x: centerX + 100, y: centerY, level: 1 },
      worldPosition: floorplanToARWorldCoordinates({ x: centerX + 100, y: centerY, level: 1 }),
      description: "Acoustic video-call booth with task lighting",
      zoneId: "zone-booth",
      isAvailable: true,
    });
  }

  // 3. Power Outlets (From DEFAULT_FLOOR_PLAN_SEATS seats with hasPowerSocket)
  const powerSeats = DEFAULT_FLOOR_PLAN_SEATS.filter((s) => s.hasPowerSocket);
  if (powerSeats.length > 0) {
    powerSeats.slice(0, 3).forEach((seat) => {
      destinations.push({
        id: `power-outlet-${seat.id}`,
        category: "power_outlet",
        name: `Charging Station (Desk ${seat.label})`,
        floorplanCoord: { x: seat.x, y: seat.y, level: 1 },
        worldPosition: floorplanToARWorldCoordinates({ x: seat.x, y: seat.y, level: 1 }),
        description: `Dedicated 240V AC and dual USB-C PD power outlets at desk ${seat.label}`,
        zoneId: seat.type ? `zone-${seat.type}` : undefined,
        isAvailable: true,
      });
    });
  } else {
    destinations.push({
      id: "power-outlet-main-hub",
      category: "power_outlet",
      name: "Central High-Speed Charging Hub",
      floorplanCoord: { x: 310, y: 235, level: 1 },
      worldPosition: floorplanToARWorldCoordinates({ x: 310, y: 235, level: 1 }),
      description: "High-wattage multi-port laptop and mobile charging station",
      isAvailable: true,
    });
  }

  // 4. Fallback destination without coordinates for edge case validation
  destinations.push({
    id: "facility-maintenance-room",
    category: "power_outlet",
    name: "Secondary Utility Hub (Unmapped)",
    description: "Physical coordinate survey pending",
    isAvailable: false,
  });

  return destinations;
}

/**
 * Converts 2D venue floorplan SVG coordinates into 3D metric AR World coordinates.
 * Floorplan X maps to AR World X.
 * Floorplan Y maps to AR World Z (ground plane in Three.js/WebXR).
 * Height/elevation maps to AR World Y.
 *
 * @param coord 2D floorplan coordinate
 * @param calibration Optional spatial calibration transform
 * @param defaultElevation Target Y-plane elevation (e.g., 0.5m above floor)
 */
export function floorplanToARWorldCoordinates(
  coord: VenueFloorplanCoordinate,
  calibration: SpatialCalibrationTransform = DEFAULT_CALIBRATION,
  defaultElevation: number = 0.5,
): ARWorldCoordinate {
  if (!coord || !Number.isFinite(coord.x) || !Number.isFinite(coord.y)) {
    throw new Error("Invalid floorplan coordinate provided");
  }

  const scale = calibration.scale ?? SCENE_SCALE;

  // Center coordinate relative to floorplan origin
  const unscaledX = coord.x - OFFSET_X;
  const unscaledZ = coord.y - OFFSET_Z;

  // Apply scaling to convert SVG units to real-world meters
  const metricX = unscaledX * scale;
  const metricZ = unscaledZ * scale;

  // Apply azimuth rotation around Y axis if calibrated
  const cosTheta = Math.cos(calibration.rotationY || 0);
  const sinTheta = Math.sin(calibration.rotationY || 0);

  const rotX = metricX * cosTheta - metricZ * sinTheta;
  const rotZ = metricX * sinTheta + metricZ * cosTheta;

  // Apply world origin offset
  const finalX = rotX + (calibration.originX || 0);
  const finalY = (calibration.originY || 0) + defaultElevation;
  const finalZ = rotZ + (calibration.originZ || 0);

  return {
    x: Math.round(finalX * 1000) / 1000,
    y: Math.round(finalY * 1000) / 1000,
    z: Math.round(finalZ * 1000) / 1000,
  };
}

/**
 * Converts 3D metric AR World coordinates back into 2D venue floorplan SVG coordinates.
 *
 * @param worldCoord 3D AR world coordinate
 * @param calibration Optional spatial calibration transform
 */
export function arWorldToFloorplanCoordinates(
  worldCoord: ARWorldCoordinate,
  calibration: SpatialCalibrationTransform = DEFAULT_CALIBRATION,
): VenueFloorplanCoordinate {
  if (
    !worldCoord ||
    !Number.isFinite(worldCoord.x) ||
    !Number.isFinite(worldCoord.z)
  ) {
    throw new Error("Invalid AR world coordinate provided");
  }

  const scale = calibration.scale ?? SCENE_SCALE;
  if (scale === 0) {
    throw new Error("Calibration scale cannot be zero");
  }

  // Reverse translation
  const transX = worldCoord.x - (calibration.originX || 0);
  const transZ = worldCoord.z - (calibration.originZ || 0);

  // Reverse azimuth rotation
  const cosTheta = Math.cos(-(calibration.rotationY || 0));
  const sinTheta = Math.sin(-(calibration.rotationY || 0));

  const unrotX = transX * cosTheta - transZ * sinTheta;
  const unrotZ = transX * sinTheta + transZ * cosTheta;

  // Reverse scaling
  const unscaledX = unrotX / scale;
  const unscaledZ = unrotZ / scale;

  // Restore SVG offset
  const svgX = unscaledX + OFFSET_X;
  const svgY = unscaledZ + OFFSET_Z;

  return {
    x: Math.round(svgX * 10) / 10,
    y: Math.round(svgY * 10) / 10,
    level: 1,
  };
}

/**
 * Checks whether native WebXR spatial anchors are supported on the provided session.
 */
export function isSpatialAnchorSupported(session: any): boolean {
  if (!session) return false;
  return (
    typeof session.createAnchor === "function" ||
    typeof session.requestAnchor === "function" ||
    (Array.isArray(session.enabledFeatures) &&
      session.enabledFeatures.includes("anchors"))
  );
}

/**
 * Creates a spatial anchor for a target destination.
 * If native WebXR anchors are supported, attempts to create a session anchor via the WebXR API.
 * Otherwise, falls back to a session-local reference space anchor matrix.
 */
export async function createDestinationAnchor(
  session: any,
  referenceSpace: any,
  destination: WayfindingDestination,
): Promise<SpatialAnchor> {
  if (!destination.worldPosition) {
    throw new Error(
      `Cannot create anchor: Destination '${destination.name}' does not have resolved spatial coordinates.`,
    );
  }

  const pos = destination.worldPosition;
  const transformMatrix = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    pos.x, pos.y, pos.z, 1,
  ]);

  const timestamp = Date.now();
  const anchorId = `anchor-${destination.id}-${timestamp}`;

  // Check for native WebXR Anchor API
  if (session && isSpatialAnchorSupported(session) && referenceSpace) {
    try {
      const position = { x: pos.x, y: pos.y, z: pos.z };
      const orientation = { x: 0, y: 0, z: 0, w: 1 };

      let xrAnchor: any = null;
      if (typeof session.requestAnchor === "function") {
        xrAnchor = await session.requestAnchor(position, orientation);
      } else if (typeof session.createAnchor === "function") {
        xrAnchor = await session.createAnchor(position, orientation);
      }

      if (xrAnchor) {
        return {
          id: anchorId,
          destinationId: destination.id,
          trackingMode: "persistent-webxr",
          position: pos,
          orientation,
          matrix: transformMatrix,
          xrAnchor,
          createdAt: timestamp,
          lastUpdated: timestamp,
        };
      }
    } catch (err) {
      console.warn(
        `[SpatialAnchors] Native WebXR anchor creation failed for ${destination.name}, falling back to session-local tracking:`,
        err,
      );
    }
  }

  // Session-local fallback using standard reference space coordinates
  return {
    id: anchorId,
    destinationId: destination.id,
    trackingMode: "session-local",
    position: pos,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    matrix: transformMatrix,
    createdAt: timestamp,
    lastUpdated: timestamp,
  };
}

/**
 * Updates an anchor's world matrix from the current XRFrame if native tracking is active.
 */
export function updateAnchorPose(
  anchor: SpatialAnchor,
  frame: any,
  referenceSpace: any,
): SpatialAnchor {
  if (!anchor) return anchor;

  if (anchor.trackingMode === "persistent-webxr" && anchor.xrAnchor && frame && referenceSpace) {
    try {
      const anchorSpace = anchor.xrAnchor.anchorSpace || anchor.xrAnchor;
      if (anchorSpace && typeof frame.getPose === "function") {
        const pose = frame.getPose(anchorSpace, referenceSpace);
        if (pose && pose.transform) {
          const matrix = new Float32Array(pose.transform.matrix);
          const p = pose.transform.position;
          const o = pose.transform.orientation;
          return {
            ...anchor,
            position: { x: p.x, y: p.y, z: p.z },
            orientation: { x: o.x, y: o.y, z: o.z, w: o.w },
            matrix,
            lastUpdated: Date.now(),
          };
        }
      }
    } catch (err) {
      console.warn("[SpatialAnchors] Error updating anchor pose from XRFrame:", err);
    }
  }

  return {
    ...anchor,
    lastUpdated: Date.now(),
  };
}

/**
 * Safely disposes and cleans up an active spatial anchor.
 */
export function disposeSpatialAnchor(anchor: SpatialAnchor | null | undefined): void {
  if (!anchor) return;
  if (anchor.xrAnchor && typeof anchor.xrAnchor.delete === "function") {
    try {
      anchor.xrAnchor.delete();
    } catch {
      // Safe disposal
    }
  }
}
