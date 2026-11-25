import { prisma } from "@/lib/prisma";

/**
 * Venue Amenities Real-Time Status & Incident Reporting Service
 *
 * Tracks live operational health of venue hardware and facilities
 * with TTL-based crowdsourced incident reporting and durable persistence.
 */

export type AmenityCategory =
  | "wifi"
  | "outlets"
  | "coffee"
  | "phone_booth"
  | "air_conditioning"
  | "restrooms"
  | "monitors"
  | "quiet_zone";

export type OperationalStatus =
  "OPERATIONAL" | "DEGRADED" | "OUTAGE" | "MAINTENANCE";
export type IncidentSeverity = "low" | "medium" | "critical";

export interface AmenityIncident {
  id: string;
  venueId: string;
  amenity: AmenityCategory;
  amenityLabel: string;
  title: string;
  description?: string;
  status: OperationalStatus;
  severity: IncidentSeverity;
  reportedBy: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  areaLocation?: string; // e.g. "2nd Floor Mezzanine", "North Window Desks"
  confirmationsCount: number;
  confirmedUserIds: string[];
  resolved: boolean;
  resolvedAt?: string;
  createdAt: string;
  expiresAt: string; // Auto-expires after 3 hours if unconfirmed
}

export interface AmenityHealthSummary {
  amenity: AmenityCategory;
  label: string;
  icon: string;
  status: OperationalStatus;
  statusText: string;
  badgeClass: string;
  activeIncidentsCount: number;
  lastVerifiedAt: string;
}

export const AMENITY_METADATA: Record<
  AmenityCategory,
  { label: string; icon: string; defaultStatus: OperationalStatus }
> = {
  wifi: {
    label: "High-Speed Wi-Fi",
    icon: "📶",
    defaultStatus: "OPERATIONAL",
  },
  outlets: {
    label: "Power Outlets",
    icon: "🔌",
    defaultStatus: "OPERATIONAL",
  },
  coffee: {
    label: "Espresso & Coffee Bar",
    icon: "☕",
    defaultStatus: "OPERATIONAL",
  },
  phone_booth: {
    label: "Acoustic Phone Booths",
    icon: "🚪",
    defaultStatus: "OPERATIONAL",
  },
  air_conditioning: {
    label: "HVAC & Temperature",
    icon: "❄️",
    defaultStatus: "OPERATIONAL",
  },
  restrooms: {
    label: "Restrooms & Facilities",
    icon: "🚻",
    defaultStatus: "OPERATIONAL",
  },
  monitors: {
    label: "External Displays",
    icon: "🖥️",
    defaultStatus: "OPERATIONAL",
  },
  quiet_zone: {
    label: "Quiet Focus Zone",
    icon: "🤫",
    defaultStatus: "OPERATIONAL",
  },
};

const AMENITY_CATEGORIES: AmenityCategory[] = [
  "wifi",
  "outlets",
  "coffee",
  "phone_booth",
  "air_conditioning",
  "restrooms",
  "monitors",
  "quiet_zone",
];

const DEFAULT_INCIDENT_TTL_HOURS = 3;
const CONFIRMATION_TTL_EXTENSION_MS = 2 * 60 * 60 * 1000;
const DEFAULT_EXPIRED_RETENTION_HOURS = 24 * 7;

interface PersistedConfirmationRecord {
  userId: string;
}

interface PersistedIncidentRecord {
  id: string;
  venueId: string;
  amenity: string;
  amenityLabel: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  reporterId: string;
  reporterName: string;
  reporterAvatarUrl: string | null;
  areaLocation: string | null;
  confirmationsCount: number;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  confirmations?: PersistedConfirmationRecord[];
}

function mapPersistedIncident(
  record: PersistedIncidentRecord,
): AmenityIncident {
  const confirmations = record.confirmations ?? [];
  const confirmedUserIds = confirmations.map((c) => c.userId);
  const meta = AMENITY_METADATA[record.amenity as AmenityCategory] ?? undefined;

  return {
    id: record.id,
    venueId: record.venueId,
    amenity: record.amenity as AmenityCategory,
    amenityLabel: record.amenityLabel || meta?.label || record.amenity,
    title: record.title,
    description: record.description ?? undefined,
    status: record.status as OperationalStatus,
    severity: record.severity as IncidentSeverity,
    reportedBy: {
      id: record.reporterId,
      name: record.reporterName,
      avatarUrl: record.reporterAvatarUrl,
    },
    areaLocation: record.areaLocation ?? undefined,
    confirmationsCount:
      confirmations.length > 0
        ? confirmations.length
        : record.confirmationsCount,
    confirmedUserIds,
    resolved: record.resolved,
    resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : undefined,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}

export class AmenityIncidentService {
  /**
   * Retrieves active incidents and computes overall health matrix for a venue.
   */
  public async getVenueStatus(
    venueId: string,
    _userId?: string | null,
  ): Promise<{
    overallHealthPercentage: number;
    amenities: AmenityHealthSummary[];
    activeIncidents: AmenityIncident[];
  }> {
    const now = new Date();

    const rows = await prisma.amenityIncident.findMany({
      where: {
        venueId,
        resolved: false,
        expiresAt: { gt: now },
      },
      include: {
        confirmations: {
          select: { userId: true },
          orderBy: { confirmedAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const activeIncidents = rows.map(mapPersistedIncident);

    // Group incidents by amenity
    const incidentsByAmenity = new Map<AmenityCategory, AmenityIncident[]>();
    for (const inc of activeIncidents) {
      const list = incidentsByAmenity.get(inc.amenity) || [];
      list.push(inc);
      incidentsByAmenity.set(inc.amenity, list);
    }

    let operationalCount = 0;

    const amenities: AmenityHealthSummary[] = AMENITY_CATEGORIES.map((cat) => {
      const meta = AMENITY_METADATA[cat];
      const catIncidents = incidentsByAmenity.get(cat) || [];

      let status: OperationalStatus = meta.defaultStatus;
      let statusText = "Operational · All Good";
      let badgeClass =
        "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";

      if (
        catIncidents.some(
          (i) => i.status === "OUTAGE" || i.severity === "critical",
        )
      ) {
        status = "OUTAGE";
        statusText = "Outage Reported";
        badgeClass = "bg-rose-500/10 text-rose-400 border-rose-500/20";
      } else if (catIncidents.some((i) => i.status === "MAINTENANCE")) {
        status = "MAINTENANCE";
        statusText = "Scheduled Maintenance";
        badgeClass = "bg-blue-500/10 text-blue-400 border-blue-500/20";
      } else if (catIncidents.length > 0) {
        status = "DEGRADED";
        statusText = `Degraded (${catIncidents.length} report${catIncidents.length > 1 ? "s" : ""})`;
        badgeClass = "bg-amber-500/10 text-amber-400 border-amber-500/20";
      }

      if (status === "OPERATIONAL") {
        operationalCount++;
      } else if (status === "DEGRADED") {
        operationalCount += 0.5;
      }

      return {
        amenity: cat,
        label: meta.label,
        icon: meta.icon,
        status,
        statusText,
        badgeClass,
        activeIncidentsCount: catIncidents.length,
        lastVerifiedAt:
          catIncidents[0]?.createdAt ||
          new Date(now.getTime() - 3600000).toISOString(),
      };
    });

    const overallHealthPercentage = Math.round(
      (operationalCount / AMENITY_CATEGORIES.length) * 100,
    );

    return {
      overallHealthPercentage,
      amenities,
      activeIncidents,
    };
  }

  /**
   * Reports a new amenity incident and persists initial reporter confirmation atomically.
   */
  public async reportIncident(data: {
    venueId: string;
    amenity: AmenityCategory;
    title: string;
    description?: string;
    status?: OperationalStatus;
    severity?: IncidentSeverity;
    areaLocation?: string;
    userId: string;
    userName: string;
    userAvatar?: string | null;
    ttlHours?: number;
  }): Promise<AmenityIncident> {
    const meta = AMENITY_METADATA[data.amenity] || { label: data.amenity };
    const ttlHours =
      typeof data.ttlHours === "number" &&
      Number.isFinite(data.ttlHours) &&
      data.ttlHours > 0
        ? data.ttlHours
        : DEFAULT_INCIDENT_TTL_HOURS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    const created = await prisma.$transaction(async (tx) => {
      const incident = await tx.amenityIncident.create({
        data: {
          venueId: data.venueId,
          amenity: data.amenity,
          amenityLabel: meta.label,
          title: data.title,
          description: data.description ?? null,
          status: data.status || "DEGRADED",
          severity: data.severity || "medium",
          reporterId: data.userId,
          reporterName: data.userName,
          reporterAvatarUrl: data.userAvatar ?? null,
          areaLocation: data.areaLocation ?? null,
          confirmationsCount: 1,
          resolved: false,
          createdAt: now,
          expiresAt,
        },
      });

      await tx.amenityIncidentConfirmation.create({
        data: {
          incidentId: incident.id,
          userId: data.userId,
          confirmedAt: now,
        },
      });

      return {
        ...incident,
        confirmations: [{ userId: data.userId }],
      };
    });

    return mapPersistedIncident(created);
  }

  /**
   * Confirms an active incident ("I'm also experiencing this") or extends its TTL.
   * Deduplicates confirmations per (incidentId, userId) atomically across instances.
   */
  public async confirmIncident(
    venueId: string,
    incidentId: string,
    userId: string,
  ): Promise<AmenityIncident | null> {
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.amenityIncident.findFirst({
        where: { id: incidentId, venueId },
        include: {
          confirmations: {
            select: { userId: true },
            orderBy: { confirmedAt: "asc" },
          },
        },
      });

      if (!existing || existing.resolved || existing.expiresAt <= now) {
        return null;
      }

      const insertResult = await tx.amenityIncidentConfirmation.createMany({
        data: [{ incidentId, userId, confirmedAt: now }],
        skipDuplicates: true,
      });

      if (insertResult.count === 0) {
        return existing;
      }

      const currentExpiry = existing.expiresAt.getTime();
      const base = Number.isFinite(currentExpiry)
        ? Math.max(now.getTime(), currentExpiry)
        : now.getTime();
      const nextExpiresAt = new Date(base + CONFIRMATION_TTL_EXTENSION_MS);

      const confirmationRows = await tx.amenityIncidentConfirmation.findMany({
        where: { incidentId },
        select: { userId: true },
        orderBy: { confirmedAt: "asc" },
      });

      const updatedIncident = await tx.amenityIncident.updateMany({
        where: { id: incidentId, venueId, resolved: false },
        data: {
          confirmationsCount: confirmationRows.length,
          expiresAt: nextExpiresAt,
        },
      });

      if (updatedIncident.count === 0) {
        return null;
      }

      return {
        ...existing,
        confirmationsCount: confirmationRows.length,
        expiresAt: nextExpiresAt,
        confirmations: confirmationRows,
      };
    });

    return updated ? mapPersistedIncident(updated) : null;
  }

  /**
   * Marks an incident as resolved in durable storage.
   */
  public async resolveIncident(
    venueId: string,
    incidentId: string,
  ): Promise<boolean> {
    const now = new Date();
    const result = await prisma.amenityIncident.updateMany({
      where: { id: incidentId, venueId },
      data: {
        resolved: true,
        resolvedAt: now,
      },
    });

    return result.count > 0;
  }

  /**
   * Removes expired incident records beyond the audit retention window.
   */
  public async cleanupExpiredIncidents(
    retentionHours: number = DEFAULT_EXPIRED_RETENTION_HOURS,
  ): Promise<number> {
    const safeHours =
      typeof retentionHours === "number" &&
      Number.isFinite(retentionHours) &&
      retentionHours >= 0
        ? retentionHours
        : DEFAULT_EXPIRED_RETENTION_HOURS;
    const cutoff = new Date(Date.now() - safeHours * 60 * 60 * 1000);

    const result = await prisma.amenityIncident.deleteMany({
      where: {
        expiresAt: { lt: cutoff },
      },
    });

    return result.count;
  }
}

export const amenityIncidentService = new AmenityIncidentService();
