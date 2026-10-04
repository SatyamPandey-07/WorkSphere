/**
 * Tests for smart calendar availability blocking and release rules.
 */

type BlockReason = "maintenance" | "private_event" | "staff_off" | "seasonal_closure" | "tentative";

interface CalendarBlock {
  venueId: string;
  startMs: number;
  endMs: number;
  reason: BlockReason;
  autoRelease: boolean;
  releaseDeadlineMs: number | null;
  priority: number;
}

function isBlockedSlot(venueId: string, startMs: number, endMs: number, blocks: CalendarBlock[]): boolean {
  return blocks.some((b) => b.venueId === venueId && b.startMs < endMs && startMs < b.endMs);
}

function expiredAutoRelease(blocks: CalendarBlock[], nowMs: number): CalendarBlock[] {
  return blocks.filter((b) => b.autoRelease && b.releaseDeadlineMs !== null && nowMs > b.releaseDeadlineMs);
}

function blockDurationHours(block: CalendarBlock): number {
  return Math.round((block.endMs - block.startMs) / 3_600_000 * 10) / 10;
}

function highPriorityBlocks(blocks: CalendarBlock[], minPriority = 8): CalendarBlock[] {
  return blocks.filter((b) => b.priority >= minPriority);
}

function blockedByReason(blocks: CalendarBlock[], reason: BlockReason): number {
  return blocks.filter((b) => b.reason === reason).length;
}

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const BLOCKS: CalendarBlock[] = [
  { venueId: "v1", startMs: NOW + 2*HOUR,  endMs: NOW + 6*HOUR,  reason: "maintenance",  autoRelease: false, releaseDeadlineMs: null,      priority: 9 },
  { venueId: "v1", startMs: NOW + 8*HOUR,  endMs: NOW + 12*HOUR, reason: "tentative",    autoRelease: true,  releaseDeadlineMs: NOW - HOUR, priority: 3 },
  { venueId: "v2", startMs: NOW,           endMs: NOW + 24*HOUR, reason: "private_event",autoRelease: false, releaseDeadlineMs: null,      priority: 10 },
];

describe("Smart calendar blocking", () => {
  it("isBlockedSlot: v1 slot overlaps maintenance → true", () => {
    expect(isBlockedSlot("v1", NOW + 3*HOUR, NOW + 5*HOUR, BLOCKS)).toBe(true);
  });
  it("isBlockedSlot: v1 before any blocks → false", () => {
    expect(isBlockedSlot("v1", NOW, NOW + HOUR, BLOCKS)).toBe(false);
  });
  it("expiredAutoRelease: tentative past deadline → 1 expired", () => {
    expect(expiredAutoRelease(BLOCKS, NOW).length).toBe(1);
  });
  it("blockDurationHours: maintenance = 4h", () => {
    expect(blockDurationHours(BLOCKS[0])).toBe(4);
  });
  it("highPriorityBlocks: maintenance + private_event", () => {
    expect(highPriorityBlocks(BLOCKS).length).toBe(2);
  });
  it("blockedByReason: 1 tentative block", () => {
    expect(blockedByReason(BLOCKS, "tentative")).toBe(1);
  });
});
