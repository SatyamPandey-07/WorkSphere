/**
 * Venue Amenities Real-Time Status & Incident Reporting Service
 *
 * Tracks live operational health of venue hardware and facilities
 * with TTL-based crowdsourced incident reporting and community verification.
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

export type OperationalStatus = "OPERATIONAL" | "DEGRADED" | "OUTAGE" | "MAINTENANCE";
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
  wifi: { label: "High-Speed Wi-Fi", icon: "📶", defaultStatus: "OPERATIONAL" },
  outlets: { label: "Power Outlets", icon: "🔌", defaultStatus: "OPERATIONAL" },
  coffee: { label: "Espresso & Coffee Bar", icon: "☕", defaultStatus: "OPERATIONAL" },
  phone_booth: { label: "Acoustic Phone Booths", icon: "🚪", defaultStatus: "OPERATIONAL" },
  air_conditioning: { label: "HVAC & Temperature", icon: "❄️", defaultStatus: "OPERATIONAL" },
  restrooms: { label: "Restrooms & Facilities", icon: "🚻", defaultStatus: "OPERATIONAL" },
  monitors: { label: "External Displays", icon: "🖥️", defaultStatus: "OPERATIONAL" },
  quiet_zone: { label: "Quiet Focus Zone", icon: "🤫", defaultStatus: "OPERATIONAL" },
};

// In-memory persistent cache for TTL incident tracking (survives requests within Node process)
const venueIncidentsStore = new Map<string, AmenityIncident[]>();

export class AmenityIncidentService {
  /**
   * Retrieves active incidents and computes overall health matrix for a venue.
   */
  public getVenueStatus(venueId: string, userId?: string | null): {
    overallHealthPercentage: number;
    amenities: AmenityHealthSummary[];
    activeIncidents: AmenityIncident[];
  } {
    const rawIncidents = venueIncidentsStore.get(venueId) || [];
    const now = new Date();

    // Filter unexpired and unresolved incidents
    const activeIncidents = rawIncidents.filter(
      (inc) => !inc.resolved && new Date(inc.expiresAt) > now,
    );

    // Group incidents by amenity
    const incidentsByAmenity = new Map<AmenityCategory, AmenityIncident[]>();
    for (const inc of activeIncidents) {
      const list = incidentsByAmenity.get(inc.amenity) || [];
      list.push(inc);
      incidentsByAmenity.set(inc.amenity, list);
    }

    const categories: AmenityCategory[] = [
      "wifi",
      "outlets",
      "coffee",
      "phone_booth",
      "air_conditioning",
      "restrooms",
      "monitors",
      "quiet_zone",
    ];

    let operationalCount = 0;

    const amenities: AmenityHealthSummary[] = categories.map((cat) => {
      const meta = AMENITY_METADATA[cat];
      const catIncidents = incidentsByAmenity.get(cat) || [];

      let status: OperationalStatus = meta.defaultStatus;
      let statusText = "Operational · All Good";
      let badgeClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";

      if (catIncidents.some((i) => i.status === "OUTAGE" || i.severity === "critical")) {
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
        lastVerifiedAt: catIncidents[0]?.createdAt || new Date(Date.now() - 3600000).toISOString(),
      };
    });

    const overallHealthPercentage = Math.round((operationalCount / categories.length) * 100);

    return {
      overallHealthPercentage,
      amenities,
      activeIncidents,
    };
  }

  /**
   * Reports a new amenity incident.
   */
  public reportIncident(data: {
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
  }): AmenityIncident {
    const meta = AMENITY_METADATA[data.amenity] || { label: data.amenity };
    const ttlHours =
      typeof data.ttlHours === "number" &&
      Number.isFinite(data.ttlHours) &&
      data.ttlHours > 0
        ? data.ttlHours
        : 3;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();

    const incident: AmenityIncident = {
      id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      venueId: data.venueId,
      amenity: data.amenity,
      amenityLabel: meta.label,
      title: data.title,
      description: data.description,
      status: data.status || "DEGRADED",
      severity: data.severity || "medium",
      reportedBy: {
        id: data.userId,
        name: data.userName,
        avatarUrl: data.userAvatar,
      },
      areaLocation: data.areaLocation,
      confirmationsCount: 1,
      confirmedUserIds: [data.userId],
      resolved: false,
      createdAt: now.toISOString(),
      expiresAt,
    };

    const list = venueIncidentsStore.get(data.venueId) || [];
    list.unshift(incident);
    venueIncidentsStore.set(data.venueId, list);

    return incident;
  }

  /**
   * Confirms an active incident ("I'm also experiencing this") or extends its TTL.
   */
  public confirmIncident(venueId: string, incidentId: string, userId: string): AmenityIncident | null {
    const list = venueIncidentsStore.get(venueId) || [];
    const incident = list.find((i) => i.id === incidentId);

    if (!incident || incident.resolved) return null;

    if (!incident.confirmedUserIds.includes(userId)) {
      incident.confirmedUserIds.push(userId);
      incident.confirmationsCount += 1;
      // Extend TTL by 2 hours upon confirmation, from the later of now
      // and the current expiry so confirmations never shorten an incident.
      const currentExpiry = new Date(incident.expiresAt).getTime();
      const base = Number.isFinite(currentExpiry)
        ? Math.max(Date.now(), currentExpiry)
        : Date.now();
      incident.expiresAt = new Date(base + 2 * 60 * 60 * 1000).toISOString();
    }

    return incident;
  }

  /**
   * Marks an incident as resolved.
   */
  public resolveIncident(venueId: string, incidentId: string): boolean {
    const list = venueIncidentsStore.get(venueId) || [];
    const incident = list.find((i) => i.id === incidentId);

    if (!incident) return false;

    incident.resolved = true;
    incident.resolvedAt = new Date().toISOString();
    return true;
  }
}

export const amenityIncidentService = new AmenityIncidentService();
