/**
 * Tests for smart calendar availability blocking and release rules.
 */

type BlockReason = "maintenance" | "private_event" | "staff_off" | "seasonal_closure" | "renovation" | "tentative";

interface CalendarBlock {
  venueId: string;
  startMs: number;
  endMs: number;
  reason: BlockReason;
  autoRelease: boolean;     // release block automatically after a deadline
  releaseDeadlineMs: number | null;
  priority: number;         // higher = harder to override
}

function isBlocked(
  venueId: string,
  slotStartMs: number,
  slotEndMs: number,
  blocks: CalendarBlock[]
): boolean {
  return blocks.some(
    (b) =>
      b.venueId === venueId &&
      b.startMs < slotEndMs &&
      slotStartMs < b.endMs
  );
}

function autoReleasedBlocks(blocks: CalendarBlock[], nowMs: number): CalendarBlock[] {
  return blocks.filter((b) => b.autoRelease && b.releaseDeadlineMs !== null && nowMs > b.releaseDeadlineMs);
}

function activeBlocks(blocks: CalendarBlock[], nowMs: number): CalendarBlock[] {
  const released = new Set(autoReleasedBlocks(blocks, nowMs).map((b) => `${b.venueId}${b.startMs}`));
  return blocks.filter((b) => !released.has(`${b.venueId}${b.startMs}`) && b.endMs > nowMs);
}

function highPriorityBlocks(blocks: CalendarBlock[], minPriority = 8): CalendarBlock[] {
  return blocks.filter((b) => b.priority >= minPriority);
}

function blockDurationHours(block: CalendarBlock): number {
  return Math.round((block.endMs - block.startMs) / 3_600_000 * 10) / 10;
}

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const BLOCKS: CalendarBlock[] = [
  { venueId: "v1", startMs: NOW + 2 * HOUR,  endMs: NOW + 6 * HOUR,  reason: "maintenance",     autoRelease: false, releaseDeadlineMs: null,             priority: 9 },
  { venueId: "v1", startMs: NOW + 8 * HOUR,  endMs: NOW + 12 * HOUR, reason: "tentative",        autoRelease: true,  releaseDeadlineMs: NOW - HOUR,        priority: 3 },
  { venueId: "v2", startMs: NOW,             endMs: NOW + 24 * HOUR, reason: "private_event",    autoRelease: false, releaseDeadlineMs: null,             priority: 10 },
];

describe("Smart calendar availability blocking", () => {
  it("isBlocked: v1 slot overlaps maintenance → true", () => {
    expect(isBlocked("v1", NOW + 3 * HOUR, NOW + 5 * HOUR, BLOCKS)).toBe(true);
  });

  it("isBlocked: v1 slot before any blocks → false", () => {
    expect(isBlocked("v1", NOW, NOW + HOUR, BLOCKS)).toBe(false);
  });

  it("autoReleasedBlocks: tentative block past deadline → released", () => {
    expect(autoReleasedBlocks(BLOCKS, NOW).length).toBe(1);
    expect(autoReleasedBlocks(BLOCKS, NOW)[0].reason).toBe("tentative");
  });

  it("activeBlocks: v1 maintenance still active", () => {
    const active = activeBlocks(BLOCKS, NOW);
    expect(active.some((b) => b.reason === "maintenance")).toBe(true);
    expect(active.some((b) => b.reason === "tentative")).toBe(false);
  });

  it("highPriorityBlocks: maintenance (9) and private_event (10)", () => {
    expect(highPriorityBlocks(BLOCKS).length).toBe(2);
  });

  it("blockDurationHours: maintenance = 4h", () => {
    expect(blockDurationHours(BLOCKS[0])).toBe(4);
  });
});
