import { MeetingOptimizer, type MeetingContext } from '@/core/ai/MeetingOptimizer';
import type { OverlapSlot } from '@/core/scheduling/TimezoneOverlapMatrix';
import { MultiAgentOrchestrator } from '@/lib/agents/MultiAgentOrchestrator';

describe('MeetingOptimizer with MultiAgentOrchestrator (#7166)', () => {
  let optimizer: MeetingOptimizer;

  beforeEach(() => {
    optimizer = new MeetingOptimizer();
  });

  const mockContext: MeetingContext = {
    title: 'Sprint Planning',
    participants: ['Alice', 'Bob', 'Charlie'],
    durationMinutes: 45,
    urgency: 'high',
    preferredTimeOfDay: 'afternoon',
  };

  const mockOverlaps: OverlapSlot[] = [
    {
      startUTC: 1700000000000,
      endUTC: 1700003600000,
      durationMinutes: 60,
      participantCount: 3,
      participants: ['Alice', 'Bob', 'Charlie'],
    },
    {
      startUTC: 1700007200000,
      endUTC: 1700009000000,
      durationMinutes: 30, // Insufficient duration (< 45)
      participantCount: 3,
      participants: ['Alice', 'Bob', 'Charlie'],
    },
    {
      startUTC: 1700010800000,
      endUTC: 1700018000000,
      durationMinutes: 120,
      participantCount: 2,
      participants: ['Alice', 'Bob'],
    },
  ];

  it('filters and sorts viable meeting slots correctly', async () => {
    const slots = await optimizer.optimizeMeeting(mockContext, mockOverlaps);

    expect(slots).toHaveLength(2); // Only slots with >= 45 mins
    expect(slots[0].participantCount).toBe(3); // Higher participant count first
    expect(slots[1].participantCount).toBe(2);
  });

  it('ranks slots with an adequate recovery gap ahead of back-to-back slots', async () => {
    const dayStart = Date.UTC(2026, 10, 12, 10, 0);
    const laterStart = Date.UTC(2026, 10, 12, 12, 0);
    const slots: OverlapSlot[] = [
      {
        startUTC: dayStart,
        endUTC: dayStart + 60 * 60_000,
        durationMinutes: 60,
        participantCount: 2,
        participants: ['Alice', 'Bob'],
      },
      {
        startUTC: laterStart,
        endUTC: laterStart + 60 * 60_000,
        durationMinutes: 60,
        participantCount: 2,
        participants: ['Alice', 'Bob'],
      },
    ];
    const context: MeetingContext = {
      ...mockContext,
      participants: ['Alice', 'Bob'],
      participantTimezones: { Alice: 'UTC', Bob: 'UTC' },
      participantBusyIntervals: {
        Alice: [
          { startUTC: dayStart - 10 * 60_000, endUTC: dayStart - 5 * 60_000 },
          { startUTC: laterStart - 30 * 60_000, endUTC: laterStart - 15 * 60_000 },
        ],
        Bob: [
          { startUTC: dayStart - 10 * 60_000, endUTC: dayStart - 5 * 60_000 },
          { startUTC: laterStart - 30 * 60_000, endUTC: laterStart - 15 * 60_000 },
        ],
      },
    };

    const optimized = await optimizer.optimizeMeeting(context, slots);
    expect(optimized[0].startUTC).toBe(laterStart);
    expect(optimized[1].startUTC).toBe(dayStart);
  });

  it('applies a stronger recovery penalty during a participant\'s local late night', async () => {
    const dayStart = Date.UTC(2026, 10, 12, 14, 0);
    const lateStart = Date.UTC(2026, 10, 12, 22, 0);
    const slots: OverlapSlot[] = [
      {
        startUTC: lateStart,
        endUTC: lateStart + 60 * 60_000,
        durationMinutes: 60,
        participantCount: 1,
        participants: ['Alice'],
      },
      {
        startUTC: dayStart,
        endUTC: dayStart + 60 * 60_000,
        durationMinutes: 60,
        participantCount: 1,
        participants: ['Alice'],
      },
    ];

    const optimized = await optimizer.optimizeMeeting(
      {
        ...mockContext,
        participants: ['Alice'],
        participantTimezones: { Alice: 'UTC' },
        participantBusyIntervals: {
          Alice: [
            { startUTC: dayStart - 10 * 60_000, endUTC: dayStart - 5 * 60_000 },
            { startUTC: lateStart - 10 * 60_000, endUTC: lateStart - 5 * 60_000 },
          ],
        },
      },
      slots,
    );

    expect(optimized[0].startUTC).toBe(dayStart);
    expect(optimized[1].startUTC).toBe(lateStart);
  });

  it('provides an integrated MultiAgentOrchestrator instance', () => {
    const orchestrator = optimizer.getOrchestrator();
    expect(orchestrator).toBeInstanceOf(MultiAgentOrchestrator);
    expect(orchestrator.getConfig().pruningThreshold).toBe(0.75);
  });

  it('optimizes meetings with token budget governor and returns telemetry', async () => {
    const result = await optimizer.optimizeMeetingWithGovernor(mockContext, mockOverlaps);

    expect(result.slots).toHaveLength(2);
    expect(result.selectedSlot).not.toBeNull();
    expect(result.selectedSlot?.durationMinutes).toBe(60);
    expect(result.rationale).toBeDefined();
    expect(result.telemetry).not.toBeNull();
    expect(result.telemetry?.promptTokens).toBeGreaterThan(0);
  });

  it('handles empty overlaps gracefully', async () => {
    const result = await optimizer.optimizeMeetingWithGovernor(mockContext, []);
    expect(result.slots).toHaveLength(0);
    expect(result.selectedSlot).toBeNull();
    expect(result.telemetry).toBeNull();
  });
});
