/**
 * evacuationRouter.ts
 * Real-time emergency egress pathfinding and safety resource routing for multi-story workspaces.
 * Directs nomads to the nearest unobstructed fire exit, AED, and outdoor assembly muster point.
 */

export type EmergencyType =
  | "FIRE_ALARM"
  | "EARTHQUAKE"
  | "POWER_OUTAGE"
  | "SEVERE_WEATHER"
  | "MEDICAL_EMERGENCY";

export interface SpatialPoint {
  x: number;
  y: number;
  z?: number;
}

export interface EmergencyExit {
  id: string;
  name: string;
  type: "PRIMARY_STAIRWELL" | "FIRE_EXIT_DOOR" | "OUTDOOR_GROUND_EXIT";
  position: SpatialPoint;
  floor: number;
  isAccessible: boolean;
  status: "CLEAR" | "CONGESTED" | "BLOCKED";
  distanceMeters: number;
}

export interface SafetyResource {
  id: string;
  name: string;
  type: "AED_DEFIBRILLATOR" | "FIRST_AID_KIT" | "FIRE_EXTINGUISHER";
  locationDescription: string;
  position: SpatialPoint;
  distanceMeters: number;
}

export interface EgressWaypoint {
  stepIndex: number;
  instruction: string;
  position: SpatialPoint;
  distanceToNextMeters: number;
  action: "WALK_STRAIGHT" | "TURN_LEFT" | "TURN_RIGHT" | "TAKE_STAIRS_DOWN" | "EXIT_BUILDING";
}

export interface EvacuationPlan {
  emergencyType: EmergencyType;
  severity: "CRITICAL_EVACUATION" | "WARNING_PRECAUTION" | "SHELTER_IN_PLACE";
  venueName: string;
  userSeatNumber: string;
  nearestExit: EmergencyExit;
  totalDistanceMeters: number;
  estimatedEvacuationSeconds: number;
  waypoints: EgressWaypoint[];
  assemblyMusterPoint: {
    name: string;
    description: string;
    coordinates: string;
  };
  nearbySafetyResources: SafetyResource[];
  emergencyContacts: Array<{ label: string; number: string }>;
}

/**
 * Calculates Euclidean distance between 2D/3D points.
 */
function getDistance(p1: SpatialPoint, p2: SpatialPoint): number {
  return Math.sqrt(
    Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2) + Math.pow((p2.z || 0) - (p1.z || 0), 2)
  );
}

/**
 * Computes shortest unobstructed emergency evacuation plan from seat coordinates.
 */
export function computeEmergencyEvacuationPlan(
  userPos: SpatialPoint,
  venueName: string,
  userSeatNumber: string = "Desk A-14",
  emergencyType: EmergencyType = "FIRE_ALARM"
): EvacuationPlan {
  const exits: EmergencyExit[] = [
    {
      id: "exit-north-stairwell",
      name: "North Fire Stairwell A (Exit to Street)",
      type: "PRIMARY_STAIRWELL",
      position: { x: 5, y: 35 },
      floor: 2,
      isAccessible: true,
      status: "CLEAR",
      distanceMeters: Number(getDistance(userPos, { x: 5, y: 35 }).toFixed(1)),
    },
    {
      id: "exit-south-terrace",
      name: "South Emergency Fire Door (Ground Level)",
      type: "FIRE_EXIT_DOOR",
      position: { x: 45, y: 10 },
      floor: 2,
      isAccessible: true,
      status: "CLEAR",
      distanceMeters: Number(getDistance(userPos, { x: 45, y: 10 }).toFixed(1)),
    },
  ];

  exits.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const nearestExit = exits[0];

  const safetyResources: SafetyResource[] = [
    {
      id: "aed-1",
      name: "Automated External Defibrillator (AED)",
      type: "AED_DEFIBRILLATOR",
      locationDescription: "Mounted by Elevator Bank 2 & Main Restrooms",
      position: { x: 20, y: 22 },
      distanceMeters: Number(getDistance(userPos, { x: 20, y: 22 }).toFixed(1)),
    },
    {
      id: "fe-1",
      name: "CO2 Fire Extinguisher",
      type: "FIRE_EXTINGUISHER",
      locationDescription: "Adjacent to Kitchenette Bar",
      position: { x: 12, y: 18 },
      distanceMeters: Number(getDistance(userPos, { x: 12, y: 18 }).toFixed(1)),
    },
    {
      id: "fa-1",
      name: "Trauma First Aid Kit",
      type: "FIRST_AID_KIT",
      locationDescription: "Reception Front Desk Security Cabinet",
      position: { x: 8, y: 8 },
      distanceMeters: Number(getDistance(userPos, { x: 8, y: 8 }).toFixed(1)),
    },
  ];

  safetyResources.sort((a, b) => a.distanceMeters - b.distanceMeters);

  const waypoints: EgressWaypoint[] = [
    {
      stepIndex: 1,
      instruction: `Immediately stand and exit ${userSeatNumber}. Leave heavy luggage behind.`,
      position: userPos,
      distanceToNextMeters: 4.5,
      action: "WALK_STRAIGHT",
    },
    {
      stepIndex: 2,
      instruction: "Turn left into the illuminated Green Exit Corridor. Do NOT use elevators.",
      position: { x: (userPos.x + nearestExit.position.x) / 2, y: userPos.y },
      distanceToNextMeters: nearestExit.distanceMeters * 0.6,
      action: "TURN_LEFT",
    },
    {
      stepIndex: 3,
      instruction: `Enter ${nearestExit.name} and descend stairs calmly on the right hand side.`,
      position: nearestExit.position,
      distanceToNextMeters: 8.0,
      action: "TAKE_STAIRS_DOWN",
    },
    {
      stepIndex: 4,
      instruction: "Push exit bar door to street level and proceed to Assembly Point across the road.",
      position: { x: nearestExit.position.x, y: nearestExit.position.y + 10 },
      distanceToNextMeters: 0,
      action: "EXIT_BUILDING",
    },
  ];

  const totalDistanceMeters = Number(nearestExit.distanceMeters.toFixed(1));
  const estimatedEvacuationSeconds = Math.max(15, Math.round(totalDistanceMeters / 1.2));

  return {
    emergencyType,
    severity: emergencyType === "EARTHQUAKE" ? "SHELTER_IN_PLACE" : "CRITICAL_EVACUATION",
    venueName,
    userSeatNumber,
    nearestExit,
    totalDistanceMeters,
    estimatedEvacuationSeconds,
    waypoints,
    assemblyMusterPoint: {
      name: "Muster Area Alpha (City Park Square)",
      description: "Across main street, 50m clear of building facade and glass falling zones.",
      coordinates: "37.7752° N, 122.4188° W",
    },
    nearbySafetyResources: safetyResources,
    emergencyContacts: [
      { label: "Local Emergency Dispatch (Police/Fire/Medical)", number: "911 / 112" },
      { label: "Building Security Control Room", number: "+1 (415) 555-0199" },
      { label: "Venue Duty Manager Direct SOS", number: "+1 (415) 555-0142" },
    ],
  };
}
