/**
 * Tests for booking timeline/Gantt view data generation.
 */

interface TimelineItem {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  color: string;
}

function timelineOverlapMs(a: TimelineItem, b: TimelineItem): number {
  const start = Math.max(a.startMs, b.startMs);
  const end = Math.min(a.endMs, b.endMs);
  return Math.max(0, end - start);
}

function fitIntoLane(
  items: TimelineItem[]
): { item: TimelineItem; lane: number }[] {
  const lanes: TimelineItem[][] = [];
  const result: { item: TimelineItem; lane: number }[] = [];
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs);

  for (const item of sorted) {
    let placed = false;
    for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
      const lastInLane = lanes[laneIdx][lanes[laneIdx].length - 1];
      if (lastInLane.endMs <= item.startMs) {
        lanes[laneIdx].push(item);
        result.push({ item, lane: laneIdx });
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([item]);
      result.push({ item, lane: lanes.length - 1 });
    }
  }
  return result;
}

function timelineWidth(items: TimelineItem[]): number {
  if (items.length === 0) return 0;
  const minStart = Math.min(...items.map((i) => i.startMs));
  const maxEnd = Math.max(...items.map((i) => i.endMs));
  return maxEnd - minStart;
}

const NOW = 1_700_000_000_000;
const ITEMS: TimelineItem[] = [
  { id: "t1", label: "Booking A", startMs: NOW,           endMs: NOW + 3_600_000, color: "blue"  },
  { id: "t2", label: "Booking B", startMs: NOW + 1_800_000, endMs: NOW + 5_400_000, color: "green" },
  { id: "t3", label: "Booking C", startMs: NOW + 3_600_000, endMs: NOW + 7_200_000, color: "red"   },
];

describe("Booking timeline view", () => {
  it("timelineOverlapMs: overlapping items", () => {
    expect(timelineOverlapMs(ITEMS[0], ITEMS[1])).toBe(1_800_000);
  });

  it("timelineOverlapMs: adjacent items → 0", () => {
    expect(timelineOverlapMs(ITEMS[0], ITEMS[2])).toBe(0);
  });

  it("timelineOverlapMs: non-overlapping → 0", () => {
    const late: TimelineItem = { ...ITEMS[0], startMs: NOW + 10_000_000, endMs: NOW + 11_000_000 };
    expect(timelineOverlapMs(ITEMS[0], late)).toBe(0);
  });

  it("fitIntoLane: t1 in lane 0", () => {
    const result = fitIntoLane(ITEMS);
    expect(result.find((r) => r.item.id === "t1")!.lane).toBe(0);
  });

  it("fitIntoLane: overlapping items get different lanes", () => {
    const result = fitIntoLane(ITEMS);
    const t1Lane = result.find((r) => r.item.id === "t1")!.lane;
    const t2Lane = result.find((r) => r.item.id === "t2")!.lane;
    expect(t1Lane).not.toBe(t2Lane);
  });

  it("fitIntoLane: non-overlapping t3 can reuse lane 0", () => {
    const result = fitIntoLane(ITEMS);
    expect(result.find((r) => r.item.id === "t3")!.lane).toBe(0);
  });

  it("timelineWidth: spans from first start to last end", () => {
    expect(timelineWidth(ITEMS)).toBe(7_200_000);
  });

  it("timelineWidth: empty → 0", () => {
    expect(timelineWidth([])).toBe(0);
  });
});
