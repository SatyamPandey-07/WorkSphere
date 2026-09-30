/**
 * Tests for venue collaborative hub features (shared docs, whiteboards).
 */

type HubFeature = "virtual_whiteboard" | "shared_notes" | "video_wall" | "interactive_display" | "cloud_sharing";

interface CollaborativeHub {
  hubId: string;
  venueId: string;
  roomId: string;
  availableFeatures: HubFeature[];
  maxParticipants: number;
  currentParticipants: string[];
  sessionActive: boolean;
  sessionStartedAt: number | null;
}

function hasFeature(hub: CollaborativeHub, feature: HubFeature): boolean {
  return hub.availableFeatures.includes(feature);
}

function joinHub(hub: CollaborativeHub, userId: string): CollaborativeHub {
  if (hub.currentParticipants.includes(userId)) return hub; // already joined
  if (hub.currentParticipants.length >= hub.maxParticipants) {
    throw new Error("Hub at capacity");
  }
  return { ...hub, currentParticipants: [...hub.currentParticipants, userId] };
}

function startSession(hub: CollaborativeHub, nowMs: number): CollaborativeHub {
  if (hub.currentParticipants.length === 0) throw new Error("Need participants to start");
  return { ...hub, sessionActive: true, sessionStartedAt: nowMs };
}

function endSession(hub: CollaborativeHub): CollaborativeHub {
  return { ...hub, sessionActive: false, sessionStartedAt: null, currentParticipants: [] };
}

function sessionDurationMinutes(hub: CollaborativeHub, nowMs: number): number | null {
  if (!hub.sessionActive || hub.sessionStartedAt === null) return null;
  return Math.floor((nowMs - hub.sessionStartedAt) / 60_000);
}

const NOW = 1_700_000_000_000;
const HUB: CollaborativeHub = {
  hubId: "h1", venueId: "v1", roomId: "r1",
  availableFeatures: ["virtual_whiteboard", "shared_notes", "cloud_sharing"],
  maxParticipants: 5, currentParticipants: ["u1", "u2"],
  sessionActive: false, sessionStartedAt: null,
};

describe("Venue collaborative hub", () => {
  it("hasFeature: virtual_whiteboard → true", () => {
    expect(hasFeature(HUB, "virtual_whiteboard")).toBe(true);
  });

  it("hasFeature: video_wall → false", () => {
    expect(hasFeature(HUB, "video_wall")).toBe(false);
  });

  it("joinHub: adds new participant", () => {
    const updated = joinHub(HUB, "u3");
    expect(updated.currentParticipants).toContain("u3");
  });

  it("joinHub: already joined → no change", () => {
    const updated = joinHub(HUB, "u1");
    expect(updated.currentParticipants).toHaveLength(2);
  });

  it("joinHub: throws at capacity", () => {
    const full = { ...HUB, currentParticipants: ["u1", "u2", "u3", "u4", "u5"] };
    expect(() => joinHub(full, "u6")).toThrow("capacity");
  });

  it("startSession: activates session", () => {
    const started = startSession(HUB, NOW);
    expect(started.sessionActive).toBe(true);
    expect(started.sessionStartedAt).toBe(NOW);
  });

  it("startSession: throws with no participants", () => {
    const empty = { ...HUB, currentParticipants: [] };
    expect(() => startSession(empty, NOW)).toThrow("participants");
  });

  it("endSession: clears participants and session", () => {
    const active = startSession(HUB, NOW);
    const ended = endSession(active);
    expect(ended.sessionActive).toBe(false);
    expect(ended.currentParticipants).toHaveLength(0);
  });

  it("sessionDurationMinutes: inactive → null", () => {
    expect(sessionDurationMinutes(HUB, NOW)).toBeNull();
  });
});
