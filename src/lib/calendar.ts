export const formatDateTimeForCalendar = (dateStr: string, timeStr: string) => {
    if (!dateStr || !timeStr) return { start: "", end: "" };
    const start = new Date(`${dateStr}T${timeStr}`);
    if (isNaN(start.getTime())) return { start: "", end: "" };
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    
    const format = (d: Date) => d.toISOString().replace(/-|:|\.\d\d\d/g, "");
    
    return {
        start: format(start),
        end: format(end)
    };
};

export const getCalendarUrls = (venueName: string, venueAddress: string, dateStr: string, timeStr: string) => {
    const { start, end } = formatDateTimeForCalendar(dateStr, timeStr);
    const title = encodeURIComponent(`Booking at ${venueName}`);
    const details = encodeURIComponent(`Hot desk booking at ${venueName}`);
    const location = encodeURIComponent(venueAddress);

    const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
    const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${start}&enddt=${end}&body=${details}&location=${location}`;
    
    return { googleUrl, outlookUrl, start, end };
};

export const downloadICS = (venueName: string, venueAddress: string, dateStr: string, timeStr: string) => {
    const { start, end } = formatDateTimeForCalendar(dateStr, timeStr);
    if (!start) return;
    const title = `Booking at ${venueName}`;
    const description = `Hot desk booking at ${venueName}`;
    
    const icsContent = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:${start}\nDTEND:${end}\nSUMMARY:${title}\nDESCRIPTION:${description}\nLOCATION:${venueAddress}\nEND:VEVENT\nEND:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `booking-${venueName.replace(/\\s+/g, '-').toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
