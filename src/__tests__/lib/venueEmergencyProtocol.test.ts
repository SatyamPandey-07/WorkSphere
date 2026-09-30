/**
 * Tests for venue emergency protocol activation and escalation.
 */

type EmergencyType = "fire" | "medical" | "security" | "power_outage" | "evacuation";
type ProtocolStatus = "inactive" | "alert" | "active" | "resolved";

interface EmergencyProtocol {
  protocolId: string;
  venueId: string;
  type: EmergencyType;
  status: ProtocolStatus;
  triggeredAt: number | null;
  resolvedAt: number | null;
  affectedZones: string[];
  notifiedStaff: string[];
  evacuationRequired: boolean;
}

function activateProtocol(
  protocol: EmergencyProtocol,
  zones: string[],
  nowMs: number
): EmergencyProtocol {
  if (protocol.status === "active") return protocol; // already active
  return {
    ...protocol,
    status: "active",
    triggeredAt: nowMs,
    affectedZones: zones,
  };
}

function resolveProtocol(protocol: EmergencyProtocol, nowMs: number): EmergencyProtocol {
  if (protocol.status !== "active") throw new Error("Protocol is not active");
  return { ...protocol, status: "resolved", resolvedAt: nowMs };
}

function notifyStaff(protocol: EmergencyProtocol, staffIds: string[]): EmergencyProtocol {
  return {
    ...protocol,
    notifiedStaff: [...new Set([...protocol.notifiedStaff, ...staffIds])],
  };
}

function responseTimeMinutes(protocol: EmergencyProtocol, nowMs: number): number | null {
  if (!protocol.triggeredAt) return null;
  const end = protocol.resolvedAt ?? nowMs;
  return Math.floor((end - protocol.triggeredAt) / 60_000);
}

function requiresEvacuation(protocol: EmergencyProtocol): boolean {
  return protocol.evacuationRequired || protocol.type === "fire";
}

const NOW = 1_700_000_000_000;
const PROTOCOL: EmergencyProtocol = {
  protocolId: "ep1", venueId: "v1", type: "fire",
  status: "inactive", triggeredAt: null, resolvedAt: null,
  affectedZones: [], notifiedStaff: [], evacuationRequired: false,
};

describe("Venue emergency protocol", () => {
  it("activateProtocol: transitions to active", () => {
    const activated = activateProtocol(PROTOCOL, ["lobby", "floor1"], NOW);
    expect(activated.status).toBe("active");
    expect(activated.triggeredAt).toBe(NOW);
    expect(activated.affectedZones).toContain("lobby");
  });

  it("activateProtocol: already active → no change", () => {
    const active = { ...PROTOCOL, status: "active" as ProtocolStatus, triggeredAt: NOW - 1000 };
    expect(activateProtocol(active, ["zone2"], NOW).triggeredAt).toBe(NOW - 1000);
  });

  it("resolveProtocol: sets resolved", () => {
    const active = activateProtocol(PROTOCOL, [], NOW - 600_000);
    const resolved = resolveProtocol(active, NOW);
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBe(NOW);
  });

  it("resolveProtocol: throws when not active", () => {
    expect(() => resolveProtocol(PROTOCOL, NOW)).toThrow("not active");
  });

  it("notifyStaff: deduplicates staff IDs", () => {
    const notified = notifyStaff(PROTOCOL, ["s1", "s2"]);
    const again = notifyStaff(notified, ["s2", "s3"]);
    expect(new Set(again.notifiedStaff).size).toBe(again.notifiedStaff.length);
  });

  it("responseTimeMinutes: 10 min response", () => {
    const active = activateProtocol(PROTOCOL, [], NOW - 600_000);
    const resolved = resolveProtocol(active, NOW);
    expect(responseTimeMinutes(resolved, NOW)).toBe(10);
  });

  it("requiresEvacuation: fire type always evacuates", () => {
    expect(requiresEvacuation(PROTOCOL)).toBe(true);
  });

  it("requiresEvacuation: medical no evacuation by default", () => {
    const medical = { ...PROTOCOL, type: "medical" as EmergencyType };
    expect(requiresEvacuation(medical)).toBe(false);
  });
});
