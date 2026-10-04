/**
 * Tests for venue emergency protocol and incident response management.
 */

type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentStatus = "reported" | "acknowledged" | "responding" | "contained" | "resolved" | "post_mortem";

interface IncidentReport {
  id: string;
  venueId: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  type: "fire" | "medical" | "security" | "structural" | "power" | "environmental";
  reportedAt: number;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
  affectedGuests: number;
  evacuationRequired: boolean;
}

const SLA_ACKNOWLEDGE_MINUTES: Record<IncidentSeverity, number> = {
  low: 60, medium: 30, high: 10, critical: 5,
};

function acknowledgeTimeMinutes(incident: IncidentReport): number | null {
  if (!incident.acknowledgedAt) return null;
  return Math.floor((incident.acknowledgedAt - incident.reportedAt) / 60_000);
}

function meetsAcknowledgeSla(incident: IncidentReport): boolean {
  const mins = acknowledgeTimeMinutes(incident);
  if (mins === null) return false;
  return mins <= SLA_ACKNOWLEDGE_MINUTES[incident.severity];
}

function incidentDurationMinutes(incident: IncidentReport, nowMs: number): number {
  const end = incident.resolvedAt ?? nowMs;
  return Math.floor((end - incident.reportedAt) / 60_000);
}

function requiresEvacuation(incident: IncidentReport): boolean {
  return incident.evacuationRequired || incident.severity === "critical" || incident.type === "fire";
}

function openIncidents(incidents: IncidentReport[]): IncidentReport[] {
  return incidents.filter((i) => i.status !== "resolved" && i.status !== "post_mortem");
}

function avgResolutionMinutes(incidents: IncidentReport[], nowMs: number): number {
  const resolved = incidents.filter((i) => i.resolvedAt !== null);
  if (resolved.length === 0) return 0;
  return Math.round(resolved.reduce((s, i) => s + incidentDurationMinutes(i, nowMs), 0) / resolved.length);
}

const NOW = 1_700_000_000_000;
const INCIDENTS: IncidentReport[] = [
  { id: "i1", venueId: "v1", severity: "high",     status: "resolved",  type: "medical",   reportedAt: NOW - 90 * 60_000, acknowledgedAt: NOW - 80 * 60_000, resolvedAt: NOW - 30 * 60_000, affectedGuests: 1,   evacuationRequired: false },
  { id: "i2", venueId: "v1", severity: "critical",  status: "responding",type: "fire",      reportedAt: NOW - 10 * 60_000, acknowledgedAt: NOW - 7  * 60_000, resolvedAt: null,               affectedGuests: 150, evacuationRequired: true },
  { id: "i3", venueId: "v1", severity: "low",       status: "reported",  type: "power",     reportedAt: NOW - 5  * 60_000, acknowledgedAt: null,              resolvedAt: null,               affectedGuests: 0,   evacuationRequired: false },
];

describe("Emergency protocol management", () => {
  it("acknowledgeTimeMinutes: i1 acknowledged 10min after report", () => {
    expect(acknowledgeTimeMinutes(INCIDENTS[0])).toBe(10);
  });

  it("meetsAcknowledgeSla: i1 high severity, 10min ≤ 10min → true", () => {
    expect(meetsAcknowledgeSla(INCIDENTS[0])).toBe(true);
  });

  it("meetsAcknowledgeSla: i2 critical, acknowledged 3min (≤5) → true", () => {
    expect(meetsAcknowledgeSla(INCIDENTS[1])).toBe(true);
  });

  it("requiresEvacuation: fire → true", () => {
    expect(requiresEvacuation(INCIDENTS[1])).toBe(true);
  });

  it("requiresEvacuation: low power issue → false", () => {
    expect(requiresEvacuation(INCIDENTS[2])).toBe(false);
  });

  it("openIncidents: 2 unresolved incidents", () => {
    expect(openIncidents(INCIDENTS).length).toBe(2);
  });
});
