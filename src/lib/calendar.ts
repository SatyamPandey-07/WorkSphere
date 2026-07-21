const escapeIcsText = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");

export const formatDateTimeForCalendar = (
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
) => {
  if (!dateStr || !timeStr) return { start: "", end: "" };
  const start = new Date(`${dateStr}T${timeStr}`);
  if (isNaN(start.getTime())) return { start: "", end: "" };
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const format = (d: Date) => d.toISOString().replace(/-|:|\.\d\d\d/g, "");

  return {
    start: format(start),
    end: format(end),
  };
};

export const getCalendarUrls = (
  venueName: string,
  venueAddress: string,
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
) => {
  const { start, end } = formatDateTimeForCalendar(
    dateStr,
    timeStr,
    durationMinutes,
  );
  const title = encodeURIComponent(`Booking at ${venueName}`);
  const details = encodeURIComponent(`Hot desk booking at ${venueName}`);
  const location = encodeURIComponent(venueAddress);

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${start}&enddt=${end}&body=${details}&location=${location}`;

  return { googleUrl, outlookUrl, start, end };
};

export const generateICSContent = (
  venueName: string,
  venueAddress: string,
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
  confirmationId = "",
) => {
  const { start, end } = formatDateTimeForCalendar(
    dateStr,
    timeStr,
    durationMinutes,
  );
  if (!start) return "";

  const durationLabel = `${durationMinutes} min`;
  const summary = confirmationId
    ? `Booking at ${venueName} (${durationLabel}) [${confirmationId}] - ${venueAddress}`
    : `Booking at ${venueName} (${durationLabel}) - ${venueAddress}`;

  const description = escapeIcsText(
    [
      `Hot desk booking at ${venueName}`,
      `Duration: ${durationLabel}`,
      confirmationId ? `Confirmation: ${confirmationId}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const uid = confirmationId
    ? `${confirmationId.replace(/[^A-Za-z0-9#-]/g, "")}@worksphere.app`
    : `booking-${start}@worksphere.app`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSphere//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeIcsText(venueAddress)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n") + "\r\n";
};

export const downloadICS = (
  venueName: string,
  venueAddress: string,
  dateStr: string,
  timeStr: string,
  durationMinutes = 60,
  confirmationId = "",
) => {
  const icsContent = generateICSContent(
    venueName,
    venueAddress,
    dateStr,
    timeStr,
    durationMinutes,
    confirmationId,
  );
  if (!icsContent) return;

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `booking-${venueName.replace(/\s+/g, "-").toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
