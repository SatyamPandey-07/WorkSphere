export interface MeetingParticipant { id: string; name?: string; timeZone: string; }
export interface MeetingSlotCandidate { startUnixMs: number; endUnixMs: number; score?: number; }
export interface ParticipantLocalWindow { participantId: string; name?: string; timeZone: string; utcOffsetLabel: string; localStartFormatted: string; localEndFormatted: string; localStartMinutesOfDay: number; localEndMinutesOfDay: number; isOutOfHours: boolean; outOfHoursReasons: Array<'before_08_00' | 'after_19_00'>; }
export interface MeetingRecommendationSummary { startUnixMs: number; endUnixMs: number; score: number; outOfHoursCount: number; isFairForAllParticipants: boolean; participants: ParticipantLocalWindow[]; summaryText: string; }
export function isValidTimeZone(timeZone: string): boolean { if (!timeZone || typeof timeZone !== 'string') return false; try { Intl.DateTimeFormat(undefined, { timeZone }); return true; } catch { return false; } }
function getLocalParts(unixMs: number, timeZone: string) {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC'; const d = new Date(unixMs);
  const map: Record<string, string> = {}; for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: safeTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)) if (p.type !== 'literal') map[p.type] = p.value;
  const fParts = new Intl.DateTimeFormat('en-US', { timeZone: safeTz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const hRaw = Number(map.hour ?? 0); const hour = hRaw === 24 ? 0 : hRaw; const minute = Number(map.minute ?? 0);
  const fh = fParts.find((p) => p.type === 'hour')?.value ?? '00'; const fm = fParts.find((p) => p.type === 'minute')?.value ?? '00';
  return { year: Number(map.year ?? 1970), month: Number(map.month ?? 1), day: Number(map.day ?? 1), hour, minute, formattedTime: `${fh === '24' ? '00' : fh}:${fm}`, minutesOfDay: hour * 60 + minute };
}
export function formatUtcOffsetLabel(unixMs: number, timeZone: string): string {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC'; const local = getLocalParts(unixMs, safeTz);
  const diffMin = Math.round((Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0) - Math.floor(unixMs / 60_000) * 60_000) / 60_000);
  if (diffMin === 0) return 'UTC+00:00';
  const sign = diffMin >= 0 ? '+' : '-'; const abs = Math.abs(diffMin);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
export function evaluateParticipantLocalWindow(participant: MeetingParticipant, startUnixMs: number, endUnixMs: number): ParticipantLocalWindow {
  const safeTz = isValidTimeZone(participant.timeZone) ? participant.timeZone : 'UTC';
  const s = getLocalParts(startUnixMs, safeTz); const e = getLocalParts(endUnixMs, safeTz);
  const reasons: Array<'before_08_00' | 'after_19_00'> = [];
  if (s.minutesOfDay < 480) reasons.push('before_08_00');
  const nextDay = endUnixMs > startUnixMs && (e.year > s.year || e.month > s.month || e.day > s.day);
  if (nextDay || e.minutesOfDay > 1140 || s.minutesOfDay > 1140) reasons.push('after_19_00');
  return { participantId: participant.id, name: participant.name, timeZone: safeTz, utcOffsetLabel: formatUtcOffsetLabel(startUnixMs, safeTz), localStartFormatted: s.formattedTime, localEndFormatted: e.formattedTime, localStartMinutesOfDay: s.minutesOfDay, localEndMinutesOfDay: e.minutesOfDay, isOutOfHours: reasons.length > 0, outOfHoursReasons: reasons };
}
export class MeetingOptimizer {
  public buildRecommendationSummary(slot: MeetingSlotCandidate, participants: readonly MeetingParticipant[]): MeetingRecommendationSummary {
    const windows = participants.map((p) => evaluateParticipantLocalWindow(p, slot.startUnixMs, slot.endUnixMs));
    const outOfHoursCount = windows.filter((w) => w.isOutOfHours).length;
    const score = typeof slot.score === 'number' && Number.isFinite(slot.score) ? slot.score : Math.max(0, 100 - outOfHoursCount * 25);
    const summaryText = windows.map((w) => `${w.name ? `${w.name} (${w.participantId})` : w.participantId}: ${w.localStartFormatted}–${w.localEndFormatted} (${w.utcOffsetLabel}, ${w.timeZone})${w.isOutOfHours ? ` [OUT OF HOURS: ${w.outOfHoursReasons.join(', ')}]` : ' [In Hours]'}`).join('\n');
    return { startUnixMs: slot.startUnixMs, endUnixMs: slot.endUnixMs, score, outOfHoursCount, isFairForAllParticipants: outOfHoursCount === 0, participants: windows, summaryText };
  }
}
export default MeetingOptimizer;
