/**
 * Tests for venue 360° virtual tour management.
 */

interface VirtualTourScene {
  sceneId: string;
  venueId: string;
  title: string;
  photoUrl: string;
  position: { x: number; y: number; z: number };
  hotspots: { targetSceneId: string; label: string; angle: number }[];
  isEntryPoint: boolean;
}

function entryScene(scenes: VirtualTourScene[], venueId: string): VirtualTourScene | null {
  return scenes.find((s) => s.venueId === venueId && s.isEntryPoint) ?? null;
}

function connectedScenes(scenes: VirtualTourScene[], sceneId: string): string[] {
  const scene = scenes.find((s) => s.sceneId === sceneId);
  return scene ? scene.hotspots.map((h) => h.targetSceneId) : [];
}

function isFullyConnected(scenes: VirtualTourScene[], venueId: string): boolean {
  const venue = scenes.filter((s) => s.venueId === venueId);
  if (venue.length === 0) return false;
  const sceneIds = new Set(venue.map((s) => s.sceneId));
  return venue.every((s) =>
    s.hotspots.length > 0 &&
    s.hotspots.every((h) => sceneIds.has(h.targetSceneId))
  );
}

function tourLength(scenes: VirtualTourScene[], venueId: string): number {
  return scenes.filter((s) => s.venueId === venueId).length;
}

const SCENES: VirtualTourScene[] = [
  {
    sceneId: "s1", venueId: "v1", title: "Entrance",  photoUrl: "s1.jpg",
    position: { x: 0, y: 0, z: 0 }, isEntryPoint: true,
    hotspots: [{ targetSceneId: "s2", label: "Main Area →", angle: 0 }],
  },
  {
    sceneId: "s2", venueId: "v1", title: "Main Area", photoUrl: "s2.jpg",
    position: { x: 5, y: 0, z: 0 }, isEntryPoint: false,
    hotspots: [
      { targetSceneId: "s1", label: "← Entrance", angle: 180 },
      { targetSceneId: "s3", label: "Terrace →", angle: 90 },
    ],
  },
  {
    sceneId: "s3", venueId: "v1", title: "Terrace",   photoUrl: "s3.jpg",
    position: { x: 10, y: 0, z: 0 }, isEntryPoint: false,
    hotspots: [{ targetSceneId: "s2", label: "← Main Area", angle: 270 }],
  },
];

describe("Venue 360° virtual tour", () => {
  it("entryScene: returns entry point for v1", () => {
    expect(entryScene(SCENES, "v1")!.sceneId).toBe("s1");
  });

  it("entryScene: no scenes for venue → null", () => {
    expect(entryScene(SCENES, "v99")).toBeNull();
  });

  it("connectedScenes: s2 connects to s1 and s3", () => {
    const connected = connectedScenes(SCENES, "s2");
    expect(connected).toContain("s1");
    expect(connected).toContain("s3");
  });

  it("connectedScenes: unknown scene → empty", () => {
    expect(connectedScenes(SCENES, "s99")).toHaveLength(0);
  });

  it("isFullyConnected: v1 fully connected → true", () => {
    expect(isFullyConnected(SCENES, "v1")).toBe(true);
  });

  it("isFullyConnected: empty venue → false", () => {
    expect(isFullyConnected(SCENES, "v99")).toBe(false);
  });

  it("tourLength: v1 has 3 scenes", () => {
    expect(tourLength(SCENES, "v1")).toBe(3);
  });
});
