export * from "./calendar/ics";
import { formatDateTimeForCalendar } from "./calendar/ics";

export const getCalendarUrls = (
  venueName: string,
  venueAddress: string,
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
  timeZone?: string,
) => {
  const { start, end } = formatDateTimeForCalendar(
    dateStr,
    timeStr,
    durationMinutes,
    timeZone,
  );
  const title = encodeURIComponent(`Booking at ${venueName}`);
  const details = encodeURIComponent(`Hot desk booking at ${venueName}`);
  const location = encodeURIComponent(venueAddress);

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${start}&enddt=${end}&body=${details}&location=${location}`;

  return { googleUrl, outlookUrl, start, end };
};
