import React, { useEffect, useMemo, useState } from 'react';
export interface CalendarDateTuple { year: number; month: number; day: number; }
export interface BookingDatePickerProps { value?: string | Date | null; monthDate?: string | Date; minDate?: string | Date; maxDate?: string | Date; timeZone?: string; onChange?: (isoDate: string, tuple: CalendarDateTuple) => void; }
const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
function pad2(n: number): string { return String(Math.floor(n)).padStart(2, '0'); }
function resolveSafeTimeZone(timeZone?: string): string | undefined { if (!timeZone || typeof timeZone !== 'string') return undefined; try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0)); return timeZone; } catch { return undefined; } }
export function tupleToNoonUtcDate(tuple: CalendarDateTuple): Date { return new Date(Date.UTC(tuple.year, tuple.month - 1, tuple.day, 12, 0, 0, 0)); }
export function formatCalendarTuple(tuple: CalendarDateTuple): string { return `${tuple.year}-${pad2(tuple.month)}-${pad2(tuple.day)}`; }
export function parseToCalendarTuple(input: string | Date, timeZone?: string): CalendarDateTuple { if (typeof input === 'string') { const trimmed = input.trim(); const match = YMD_PATTERN.exec(trimmed); if (match) return { year: Number.parseInt(match[1], 10), month: Number.parseInt(match[2], 10), day: Number.parseInt(match[3], 10) }; const parsed = new Date(trimmed); if (!Number.isNaN(parsed.getTime())) return parseToCalendarTuple(parsed, timeZone); } const date = input instanceof Date ? input : new Date(); const safeTz = resolveSafeTimeZone(timeZone); if (safeTz) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const year = Number.parseInt(parts.find((p) => p.type === 'year')?.value ?? '1970', 10); const month = Number.parseInt(parts.find((p) => p.type === 'month')?.value ?? '1', 10); const day = Number.parseInt(parts.find((p) => p.type === 'day')?.value ?? '1', 10); return { year, month, day }; } return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }; }
export function addCalendarDays(tuple: CalendarDateTuple, deltaDays: number): CalendarDateTuple { const noonUtc = Date.UTC(tuple.year, tuple.month - 1, tuple.day + Math.trunc(deltaDays), 12, 0, 0, 0); const shifted = new Date(noonUtc); return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }; }
export function buildMonthCalendarDays(year: number, month: number): CalendarDateTuple[] { const daysInMonth = new Date(Date.UTC(year, month, 0, 12, 0, 0, 0)).getUTCDate(); const days: CalendarDateTuple[] = []; for (let day = 1; day <= daysInMonth; day += 1) days.push({ year, month, day }); return days; }
export const BookingDatePicker: React.FC<BookingDatePickerProps> = ({ value, monthDate, minDate, maxDate, timeZone, onChange }) => {
  const selectedTuple = useMemo(() => (value ? parseToCalendarTuple(value, timeZone) : null), [value, timeZone]);
  const initialMonthTuple = useMemo(() => {
    if (monthDate) return parseToCalendarTuple(monthDate, timeZone);
    if (selectedTuple) return selectedTuple;
    return parseToCalendarTuple(new Date(), timeZone);
  }, [monthDate, selectedTuple, timeZone]);
  const [activeMonthTuple, setActiveMonthTuple] = useState(initialMonthTuple);

  useEffect(() => {
    setActiveMonthTuple(initialMonthTuple);
  }, [initialMonthTuple]);

  const minIso = useMemo(() => (minDate ? formatCalendarTuple(parseToCalendarTuple(minDate, timeZone)) : null), [minDate, timeZone]);
  const maxIso = useMemo(() => (maxDate ? formatCalendarTuple(parseToCalendarTuple(maxDate, timeZone)) : null), [maxDate, timeZone]);
  const days = useMemo(() => buildMonthCalendarDays(activeMonthTuple.year, activeMonthTuple.month), [activeMonthTuple.year, activeMonthTuple.month]);
  const selectedIso = selectedTuple ? formatCalendarTuple(selectedTuple) : null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key.toLowerCase() !== 't') return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const today = parseToCalendarTuple(new Date(), timeZone);
    event.preventDefault();
    setActiveMonthTuple(today);
    onChange?.(formatCalendarTuple(today), today);
  };

  return (<div data-testid="booking-date-picker" data-month={`${activeMonthTuple.year}-${pad2(activeMonthTuple.month)}`} tabIndex={0} onKeyDown={handleKeyDown}><div role="grid" aria-label="Booking calendar">{days.map((dayTuple) => { const iso = formatCalendarTuple(dayTuple); const isSelected = iso === selectedIso; const isDisabled = (minIso !== null && iso < minIso) || (maxIso !== null && iso > maxIso); return (<button key={iso} type="button" data-date={iso} aria-pressed={isSelected} disabled={isDisabled} onClick={() => onChange?.(iso, dayTuple)}>{dayTuple.day}</button>); })}</div></div>);
};
export default BookingDatePicker;
