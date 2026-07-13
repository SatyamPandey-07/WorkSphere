import { PDFPage, PDFFont } from "pdf-lib";

export const safeText = (text: string) =>
  text ? text.replace(/[^\x00-\x7F]/g, "?") : "";

export function drawSafeText(
  page: PDFPage,
  text: string,
  options: { x: number; y: number; size: number; font: PDFFont; color?: any }
) {
  try {
    page.drawText(text, options);
  } catch (err) {
    console.warn("[PDF drawText warning]: Failed to draw text, retrying with strict sanitization", err);
    try {
      const strictText = text.replace(/[^\x20-\x7E]/g, "?");
      page.drawText(strictText, options);
    } catch (fallbackErr) {
      console.error("[PDF drawText critical error]: Failed to draw text even with strict sanitization", fallbackErr);
    }
  }
}

export interface ExportableBooking {
  id: string;
  confirmationId: string;
  date: string;
  time: string;
  duration?: number | null;
  venue: {
    name: string;
    category: string;
    address: string | null;
  };
}

export function bookingsToCSV(bookings: ExportableBooking[]): string {
  const header = ["Confirmation ID", "Venue", "Category", "Address", "Date", "Time", "Price ($)", "Tax ($)", "Total ($)"];

  const escapeCsv = (value: string) => {
    const v = value ?? "";
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const rows = bookings.map((b) => {
    const hours = b.duration || 1;
    const price = hours * 15;
    const tax = Number((price * 0.08).toFixed(2));
    const total = Number((price + tax).toFixed(2));

    return [
      b.confirmationId || `WS-#${b.id}`,
      b.venue.name,
      b.venue.category || "",
      b.venue.address || "",
      b.date,
      b.time,
      price.toFixed(2),
      tax.toFixed(2),
      total.toFixed(2),
    ]
      .map((cell) => escapeCsv(String(cell)))
      .join(",")
  });

  return [header.join(","), ...rows].join("\n");
}