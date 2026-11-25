export interface MeetingParticipant {
  id: string;
  name?: string;
  timeZone: string;
}

export interface MeetingSlotCandidate {
  startUnixMs: number;
  endUnixMs: number;
  score?: number;
}

export interface ParticipantLocalWindow {
  participantId: string;
  name?: string;
  timeZone: string;
  utcOffsetLabel: string;
  localStartFormatted: string;
  localEndFormatted: string;
  localStartMinutesOfDay: number;
  localEndMinutesOfDay: number;
  isOutOfHours: boolean;
  outOfHoursReasons: Array<'before_08_00' | 'after_19_00'>;
}

export interface MeetingRecommendationSummary {
  startUnixMs: number;
  endUnixMs: number;
  score: number;
  outOfHoursCount: number;
  isFairForAllParticipants: boolean;
  participants: ParticipantLocalWindow[];
  summaryText: string;
}

const WORK_DAY_START_MINUTES = 8 * 60;
const WORK_DAY_END_MINUTES = 19 * 60;

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getLocalParts(
  unixMs: number,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  formattedTime: string;
  minutesOfDay: number;
} {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const date = new Date(unixMs);

  const partsFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = partsFormatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const year = Number(map.year ?? 1970);
  const month = Number(map.month ?? 1);
  const day = Number(map.day ?? 1);
  const rawHour = Number(map.hour ?? 0);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute ?? 0);

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const formattedParts = timeFormatter.formatToParts(date);
  const fHour = formattedParts.find((p) => p.type === 'hour')?.value ?? '00';
  const fMin = formattedParts.find((p) => p.type === 'minute')?.value ?? '00';
  const normalizedHour = fHour === '24' ? '00' : fHour;

  return {
    year,
    month,
    day,
    hour,
    minute,
    formattedTime: `${normalizedHour}:${fMin}`,
    minutesOfDay: hour * 60 + minute,
  };
}

export function formatUtcOffsetLabel(unixMs: number, timeZone: string): string {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const local = getLocalParts(unixMs, safeTz);

  const localAsUtcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    0
  );
  const actualMinuteTruncatedUtcMs = Math.floor(unixMs / 60_000) * 60_000;

  const offsetMinutesTotal = Math.round(
    (localAsUtcMs - actualMinuteTruncatedUtcMs) / 60_000
  );

  if (offsetMinutesTotal === 0) {
    return 'UTC+00:00';
  }

  const sign = offsetMinutesTotal >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutesTotal);
  const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
  const mins = String(absMinutes % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${mins}`;
}

export function evaluateParticipantLocalWindow(
  participant: MeetingParticipant,
  startUnixMs: number,
  endUnixMs: number
): ParticipantLocalWindow {
  const safeTz = isValidTimeZone(participant.timeZone)
    ? participant.timeZone
    : 'UTC';
  const startLocal = getLocalParts(startUnixMs, safeTz);
  const endLocal = getLocalParts(endUnixMs, safeTz);
  const utcOffsetLabel = formatUtcOffsetLabel(startUnixMs, safeTz);

  const outOfHoursReasons: Array<'before_08_00' | 'after_19_00'> = [];

  if (startLocal.minutesOfDay < WORK_DAY_START_MINUTES) {
    outOfHoursReasons.push('before_08_00');
  }

  const spansIntoNextDay =
    endUnixMs > startUnixMs &&
    (endLocal.year > startLocal.year ||
      endLocal.month > startLocal.month ||
      endLocal.day > startLocal.day);

  if (
    spansIntoNextDay ||
    endLocal.minutesOfDay > WORK_DAY_END_MINUTES ||
    startLocal.minutesOfDay > WORK_DAY_END_MINUTES
  ) {
    if (!outOfHoursReasons.includes('after_19_00')) {
      outOfHoursReasons.push('after_19_00');
    }
  }

  return {
    participantId: participant.id,
    name: participant.name,
    timeZone: safeTz,
    utcOffsetLabel,
    localStartFormatted: startLocal.formattedTime,
    localEndFormatted: endLocal.formattedTime,
    localStartMinutesOfDay: startLocal.minutesOfDay,
    localEndMinutesOfDay: endLocal.minutesOfDay,
    isOutOfHours: outOfHoursReasons.length > 0,
    outOfHoursReasons,
  };
}

export class MeetingOptimizer {
  public buildRecommendationSummary(
    slot: MeetingSlotCandidate,
    participants: readonly MeetingParticipant[]
  ): MeetingRecommendationSummary {
    const windows = participants.map((p) =>
      evaluateParticipantLocalWindow(p, slot.startUnixMs, slot.endUnixMs)
    );

    const outOfHoursCount = windows.filter((w) => w.isOutOfHours).length;
    const isFairForAllParticipants = outOfHoursCount === 0;
    const score =
      typeof slot.score === 'number' && Number.isFinite(slot.score)
        ? slot.score
        : Math.max(0, 100 - outOfHoursCount * 25);

    const lines = windows.map((w) => {
      const label = w.name ? `${w.name} (${w.participantId})` : w.participantId;
      const flag = w.isOutOfHours
        ? ` [OUT OF HOURS: ${w.outOfHoursReasons.join(', ')}]`
        : ' [In Hours]';
      return `${label}: ${w.localStartFormatted}–${w.localEndFormatted} (${w.utcOffsetLabel}, ${w.timeZone})${flag}`;
    });

    return {
      startUnixMs: slot.startUnixMs,
      endUnixMs: slot.endUnixMs,
      score,
      outOfHoursCount,
      isFairForAllParticipants,
      participants: windows,
      summaryText: lines.join('\n'),
    };
  }

  public rankSlotsByFairness(
    slots: readonly MeetingSlotCandidate[],
    participants: readonly MeetingParticipant[]
  ): MeetingRecommendationSummary[] {
    return slots
      .map((slot) => this.buildRecommendationSummary(slot, participants))
      .sort((a, b) => {
        if (a.outOfHoursCount !== b.outOfHoursCount) {
          return a.outOfHoursCount - b.outOfHoursCount;
        }
        return b.score - a.score;
      });
  }
}

export default MeetingOptimizer;
