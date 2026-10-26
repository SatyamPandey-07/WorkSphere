/**
 * Automated Weekly Venue Analytics & Manager CSV Exporter.
 *
 * Aggregates weekly booking revenue, venue foot-traffic check-ins, and venue ratings
 * into a formatted CSV report and emails it to venue managers via Nodemailer.
 */

import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";
import { CsvBuilder, escapeCSVField } from "../csvBuilder";

export interface VenueWeeklySummary {
  venueId: string;
  venueName: string;
  category: string;
  managerEmail: string;
  totalBookings: number;
  totalRevenue: number;
  currency: string;
  footTrafficCount: number;
  averageRating: number | null;
}

export interface WeeklyVenueAnalyticsData {
  startDate: string;
  endDate: string;
  generatedAt: string;
  venues: VenueWeeklySummary[];
}

/**
 * Generates formatted CSV string for weekly venue analytics report.
 */
export function generateWeeklyVenueAnalyticsCSV(
  data: WeeklyVenueAnalyticsData | null | undefined,
): string {
  const builder = new CsvBuilder<VenueWeeklySummary>({ lineDelimiter: "\r\n" });

  const safeData = data || {
    startDate: "",
    endDate: "",
    generatedAt: new Date().toISOString(),
    venues: [],
  };
  const venues = Array.isArray(safeData.venues) ? safeData.venues : [];

  builder.addSectionHeader("WEEKLY VENUE ANALYTICS & FOOT-TRAFFIC REPORT");
  builder.addRawLine(
    `Report Window,${escapeCSVField(safeData.startDate)} to ${escapeCSVField(safeData.endDate)}`,
  );
  builder.addRawLine(`Generated At,${escapeCSVField(safeData.generatedAt)}`);
  builder.addRawLine(`Total Venues Reported,${venues.length}`);
  builder.addBlankLine();

  builder.setColumns([
    { header: "Venue ID", accessor: (v) => v?.venueId ?? "" },
    { header: "Venue Name", accessor: (v) => v?.venueName ?? "" },
    { header: "Category", accessor: (v) => v?.category ?? "" },
    { header: "Manager Email", accessor: (v) => v?.managerEmail ?? "" },
    {
      header: "Total Bookings",
      accessor: (v) =>
        typeof v?.totalBookings === "number" && Number.isFinite(v.totalBookings)
          ? v.totalBookings
          : 0,
    },
    {
      header: "Total Revenue",
      accessor: (v) => {
        const currency = typeof v?.currency === "string" ? v.currency : "$";
        const rev =
          typeof v?.totalRevenue === "number" && Number.isFinite(v.totalRevenue)
            ? v.totalRevenue
            : 0;
        return `${currency}${rev.toFixed(2)}`;
      },
    },
    {
      header: "Foot Traffic Check-Ins",
      accessor: (v) =>
        typeof v?.footTrafficCount === "number" && Number.isFinite(v.footTrafficCount)
          ? v.footTrafficCount
          : 0,
    },
    {
      header: "Average Rating",
      accessor: (v) =>
        v &&
        v.averageRating !== null &&
        v.averageRating !== undefined &&
        typeof v.averageRating === "number" &&
        Number.isFinite(v.averageRating)
          ? v.averageRating.toFixed(1)
          : "N/A",
    },
  ]);

  if (venues.length > 0) {
    builder.addRows(venues);
  }

  return builder.build();
}

/**
 * Fetches weekly venue analytics from database over the specified date range.
 */
export async function fetchWeeklyVenueAnalyticsData(options?: {
  startDate?: Date;
  endDate?: Date;
  venueId?: string;
}): Promise<WeeklyVenueAnalyticsData> {
  const now = new Date();
  const end =
    options?.endDate instanceof Date && !isNaN(options.endDate.getTime())
      ? options.endDate
      : now;
  const start =
    options?.startDate instanceof Date && !isNaN(options.startDate.getTime())
      ? options.startDate
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const venueWhereClause = options?.venueId ? { id: options.venueId } : {};

  const venues = await prisma.venue.findMany({
    where: venueWhereClause,
    include: {
      creator: {
        select: { email: true, firstName: true, lastName: true },
      },
      bookings: {
        where: {
          createdAt: { gte: start, lte: end },
          status: { in: ["CONFIRMED", "COMPLETED"] },
        },
        select: {
          id: true,
          // Revenue is recorded per guest when a split-bill share is paid.
          guests: {
            where: { paidAt: { not: null } },
            select: { paidAmountCents: true, paidCurrency: true },
          },
        },
      },
      checkIns: {
        where: {
          createdAt: { gte: start, lte: end },
        },
        select: { id: true },
      },
    },
  });

  const venueSummaries: VenueWeeklySummary[] = venues.map((v) => {
    const totalBookings = v.bookings.length;
    const payments = v.bookings.flatMap((b) => b.guests);
    const totalRevenue =
      payments.reduce((sum, g) => sum + (g.paidAmountCents ?? 0), 0) / 100;

    const paidCurrency = payments.find((g) => g.paidCurrency)?.paidCurrency;
    const currency = paidCurrency ? `${paidCurrency.toUpperCase()} ` : "$";
    const footTrafficCount = v.checkIns.length;

    const averageRating = v.rating ?? null;

    const managerEmail =
      v.creator?.email || process.env.ADMIN_EMAIL || "manager@worksphere.app";

    return {
      venueId: v.id,
      venueName: v.name,
      category: v.category || "Coworking Space",
      managerEmail,
      totalBookings,
      totalRevenue,
      currency,
      footTrafficCount,
      averageRating,
    };
  });

  return {
    startDate: startIso,
    endDate: endIso,
    generatedAt: new Date().toISOString(),
    venues: venueSummaries,
  };
}

/**
 * Sends weekly venue analytics CSV report email via Nodemailer.
 */
export async function sendWeeklyVenueAnalyticsEmail(
  reportData: WeeklyVenueAnalyticsData | null | undefined,
  targetEmail?: string,
): Promise<{ success: boolean; recipient: string; messageId?: string }> {
  const safeData = reportData || {
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    venues: [],
  };

  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;

  const recipient =
    targetEmail ||
    (Array.isArray(safeData.venues) && safeData.venues[0]?.managerEmail) ||
    process.env.ADMIN_EMAIL ||
    "manager@worksphere.app";

  const csvContent = generateWeeklyVenueAnalyticsCSV(safeData);
  const filename = `weekly-venue-analytics-${safeData.startDate}-to-${safeData.endDate}.csv`;

  if (!SMTP_USER || !SMTP_PASS) {
    console.log(
      "[Weekly Analytics Email Skip] SMTP credentials missing in environment",
    );
    return { success: false, recipient };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const mailOptions = {
    from: `"WorkSphere Analytics" <${process.env.SMTP_FROM_EMAIL || SMTP_USER}>`,
    to: recipient,
    subject: `Weekly Venue Analytics & Revenue Report (${reportData.startDate} - ${reportData.endDate})`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
        <h2 style="color: #2563eb;">WorkSphere Weekly Venue Analytics</h2>
        <p>Attached is your automated weekly analytics report summarizing venue revenue, booking counts, and foot-traffic check-ins for the period <strong>${reportData.startDate}</strong> to <strong>${reportData.endDate}</strong>.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <ul>
          <li><strong>Report Period:</strong> ${reportData.startDate} to ${reportData.endDate}</li>
          <li><strong>Venues Summarized:</strong> ${reportData.venues.length}</li>
          <li><strong>Generated At:</strong> ${reportData.generatedAt}</li>
        </ul>
        <p style="color: #64748b; font-size: 12px;">This is an automated weekly background report generated by WorkSphere System Export Gateway.</p>
      </div>
    `,
    attachments: [
      {
        filename,
        content: csvContent,
        contentType: "text/csv; charset=utf-8",
      },
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  return { success: true, recipient, messageId: info.messageId };
}

/**
 * Triggers full weekly background analytics export job.
 */
export async function processWeeklyVenueAnalyticsJob(options?: {
  startDate?: Date;
  endDate?: Date;
  recipientEmail?: string;
}): Promise<{
  success: boolean;
  totalVenues: number;
  csvContent: string;
  emailSent: boolean;
  recipient?: string;
}> {
  const data = await fetchWeeklyVenueAnalyticsData(options);
  const csvContent = generateWeeklyVenueAnalyticsCSV(data);
  const emailResult = await sendWeeklyVenueAnalyticsEmail(
    data,
    options?.recipientEmail,
  );

  return {
    success: true,
    totalVenues: data.venues.length,
    csvContent,
    emailSent: emailResult.success,
    recipient: emailResult.recipient,
  };
}
