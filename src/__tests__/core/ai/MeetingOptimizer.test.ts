import {
  evaluateParticipantLocalWindow,
  formatUtcOffsetLabel,
  MeetingOptimizer,
} from '@/core/ai/MeetingOptimizer';

describe('MeetingOptimizer local time, UTC offset & working-hour fairness', () => {
  it('computes formatted local start/end times and UTC offsets across timezones including IST half-hour', () => {
    const startMs = Date.UTC(2026, 5, 15, 10, 0, 0);
    const endMs = Date.UTC(2026, 5, 15, 11, 0, 0);

    const optimizer = new MeetingOptimizer();
    const summary = optimizer.buildRecommendationSummary(
      { startUnixMs: startMs, endUnixMs: endMs },
      [
        { id: 'u-mumbai', name: 'Soham', timeZone: 'Asia/Kolkata' },
        { id: 'u-nyc', name: 'Alex', timeZone: 'America/New_York' },
      ]
    );

    const mumbai = summary.participants.find((p) => p.participantId === 'u-mumbai');
    const nyc = summary.participants.find((p) => p.participantId === 'u-nyc');

    expect(mumbai?.localStartFormatted).toBe('15:30');
    expect(mumbai?.localEndFormatted).toBe('16:30');
    expect(mumbai?.utcOffsetLabel).toBe('UTC+05:30');
    expect(mumbai?.isOutOfHours).toBe(false);

    expect(nyc?.localStartFormatted).toBe('06:00');
    expect(nyc?.localEndFormatted).toBe('07:00');
    expect(nyc?.utcOffsetLabel).toBe('UTC-04:00');
    expect(nyc?.isOutOfHours).toBe(true);
    expect(nyc?.outOfHoursReasons).toContain('before_08_00');
    expect(summary.isFairForAllParticipants).toBe(false);
  });

  it('flags slots ending after 19:00 local and handles DST spring/fall transitions accurately', () => {
    const beforeDstMs = Date.UTC(2026, 2, 8, 6, 0, 0);
    const afterDstMs = Date.UTC(2026, 2, 8, 8, 0, 0);

    expect(formatUtcOffsetLabel(beforeDstMs, 'America/New_York')).toBe('UTC-05:00');
    expect(formatUtcOffsetLabel(afterDstMs, 'America/New_York')).toBe('UTC-04:00');

    const lateWin = evaluateParticipantLocalWindow(
      { id: 'u-late', timeZone: 'Asia/Kolkata' },
      Date.UTC(2026, 10, 25, 13, 0, 0),
      Date.UTC(2026, 10, 25, 14, 0, 0)
    );
    expect(lateWin.localStartFormatted).toBe('18:30');
    expect(lateWin.localEndFormatted).toBe('19:30');
    expect(lateWin.isOutOfHours).toBe(true);
    expect(lateWin.outOfHoursReasons).toContain('after_19_00');
  });
});
