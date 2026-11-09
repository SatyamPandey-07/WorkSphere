import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  amenityIncidentService,
  AmenityCategory,
  OperationalStatus,
  IncidentSeverity,
} from "@/lib/venues/amenityIncidentService";
import { rateLimit } from "@/lib/rateLimit";

type RouteContext = {
  params: Promise<{
    venueId: string;
  }>;
};

const VALID_AMENITIES: AmenityCategory[] = [
  "wifi",
  "outlets",
  "coffee",
  "phone_booth",
  "air_conditioning",
  "restrooms",
  "monitors",
  "quiet_zone",
];

const VALID_STATUSES: OperationalStatus[] = ["OPERATIONAL", "DEGRADED", "OUTAGE", "MAINTENANCE"];
const VALID_SEVERITIES: IncidentSeverity[] = ["low", "medium", "critical"];

/**
 * GET /api/venues/[venueId]/incidents
 * Fetches the real-time operational health matrix and active incidents.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const { userId } = await auth();
    const data = amenityIncidentService.getVenueStatus(venueId, userId);

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error) {
    console.error("[GET /api/venues/[venueId]/incidents] Error:", error);
    return NextResponse.json(
      { success: false, error: "Unable to retrieve amenity statuses." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/venues/[venueId]/incidents
 * Submits a new incident / outage report for an amenity.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const { userId } = await auth();
    const user = await currentUser();

    const identifier = userId
      ? `incident:${userId}`
      : `incident:${request.headers.get("x-forwarded-for") || "anon"}`;

    if (!(await rateLimit(identifier, 10))) {
      return NextResponse.json(
        { success: false, error: "Too many incident reports. Please wait a moment." },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const { amenity, title, description, status, severity, areaLocation } = body;

    if (!amenity || !VALID_AMENITIES.includes(amenity)) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing amenity category." },
        { status: 400 },
      );
    }

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "A descriptive title is required." },
        { status: 400 },
      );
    }

    const cleanStatus = VALID_STATUSES.includes(status) ? status : "DEGRADED";
    const cleanSeverity = VALID_SEVERITIES.includes(severity) ? severity : "medium";

    const reportedUserId = userId || `anon-${Math.random().toString(36).substring(2, 8)}`;
    const reportedUserName =
      user?.firstName && user?.lastName
        ? `${user.firstName} ${user.lastName}`
        : user?.firstName || "Community Member";
    const reportedAvatar = user?.imageUrl || null;

    const incident = amenityIncidentService.reportIncident({
      venueId,
      amenity,
      title: title.trim(),
      description: description?.trim() || undefined,
      status: cleanStatus,
      severity: cleanSeverity,
      areaLocation: areaLocation?.trim() || undefined,
      userId: reportedUserId,
      userName: reportedUserName,
      userAvatar: reportedAvatar,
    });

    const updatedVenueStatus = amenityIncidentService.getVenueStatus(venueId, userId);

    return NextResponse.json({
      success: true,
      message: "Incident report submitted successfully.",
      incident,
      ...updatedVenueStatus,
    });
  } catch (error) {
    console.error("[POST /api/venues/[venueId]/incidents] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to report incident." },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/venues/[venueId]/incidents
 * Confirms an existing incident or marks it as resolved.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const { userId } = await auth();
    const body = await request.json().catch(() => ({}));
    const { incidentId, action } = body;

    if (!incidentId || typeof incidentId !== "string") {
      return NextResponse.json(
        { success: false, error: "Incident ID is required." },
        { status: 400 },
      );
    }

    const userKey = userId || request.headers.get("x-forwarded-for") || "anon-client";

    if (action === "confirm") {
      const updated = amenityIncidentService.confirmIncident(venueId, incidentId, userKey);
      if (!updated) {
        return NextResponse.json(
          { success: false, error: "Incident not found or already resolved." },
          { status: 404 },
        );
      }
    } else if (action === "resolve") {
      const resolved = amenityIncidentService.resolveIncident(venueId, incidentId);
      if (!resolved) {
        return NextResponse.json(
          { success: false, error: "Incident not found." },
          { status: 404 },
        );
      }
    } else {
      return NextResponse.json(
        { success: false, error: "Invalid action. Must be 'confirm' or 'resolve'." },
        { status: 400 },
      );
    }

    const updatedVenueStatus = amenityIncidentService.getVenueStatus(venueId, userId);

    return NextResponse.json({
      success: true,
      message: action === "confirm" ? "Confirmed issue." : "Marked as resolved.",
      ...updatedVenueStatus,
    });
  } catch (error) {
    console.error("[PATCH /api/venues/[venueId]/incidents] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update incident." },
      { status: 500 },
    );
  }
}
