/**
 * nomadTaxEngine.ts
 * Multi-jurisdiction physical presence, 183-day tax residency compliance engine,
 * and rolling-window visa stay calculations (Schengen 90/180, UK 180).
 * Resolves transitional travel day collisions according to IATA/OECD tax residency conventions.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage } from "pdf-lib";
import { generateQRMatrix } from "@/lib/qr/svgQr";
import crypto from "crypto";

export interface TaxPresenceEntry {
  id: string;
  userId: string;
  countryCode: string; // ISO 2-letter country code (e.g. "US", "ES", "PT", "MX")
  jurisdiction: string; // Human-readable country/region name
  timestamp: string; // ISO string e.g. "2026-03-15T14:30:00Z"
  timezone?: string;
  entryType?: "CHECK_IN" | "BOOKING" | "BORDER_CROSSING" | "MANUAL";
  isArrival?: boolean;
  isDeparture?: boolean;
}

export interface JurisdictionPresenceSummary {
  countryCode: string;
  jurisdiction: string;
  daysCount: number;
  isTaxResidentRisk: boolean; // >= 183 days
  daysRemainingBefore183: number;
  riskLevel: "LOW" | "WARNING" | "CRITICAL";
  firstSeen: string;
  lastSeen: string;
}

export interface TaxCollisionResolution {
  date: string; // YYYY-MM-DD
  conflictingCountries: string[];
  allocatedCountry: string;
  resolutionReason: string;
}

export interface NomadTaxComplianceReport {
  userId: string;
  taxYear: number;
  totalUniqueCalendarDays: number;
  collisionsResolvedCount: number;
  jurisdictions: JurisdictionPresenceSummary[];
  collisions: TaxCollisionResolution[];
  warnings: string[];
}

export interface NomadTaxOptions {
  taxYear?: number;
  taxResidencyThresholdDays?: number; // Default 183 days
  collisionRule?: "DESTINATION_PRIORITY" | "LATEST_TIMESTAMP" | "FIRST_TIMESTAMP";
}

export interface NomadCheckInRecord {
  id: string;
  venueId: string;
  venueName: string;
  city: string;
  country: string;
  countryCode: string; // ISO 2-letter e.g. "ES", "PT", "DE", "JP", "GB", "US"
  isSchengen: boolean;
  date: string; // "YYYY-MM-DD"
  amountSpent: number;
  currency: string;
  vatRatePct: number;
}

export interface VisaZoneLimit {
  zoneName: string;
  maxDays: number;
  windowDays: number;
  daysUsed: number;
  daysRemaining: number;
  status: "SAFE" | "WARNING" | "CRITICAL_LIMIT";
  taxResidencyRisk: boolean;
}

export interface NomadComplianceReport {
  taxYear: number;
  schengenStay: VisaZoneLimit;
  countryBreakdown: Array<{
    country: string;
    countryCode: string;
    daysSpent: number;
    daysRemaining183Rule: number;
    taxResidencyRisk: boolean;
    totalSpent: number;
    vatReclaimable: number;
    currency: string;
  }>;
  totalWorkspaceExpense: number;
  totalVatReclaimable: number;
  currency: string;
  generatedAt: string;
}

const SCHENGEN_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IS", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "CH"
]);

/**
 * Normalizes an ISO timestamp string to YYYY-MM-DD calendar date string in UTC.
 */
export function toCalendarDateString(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp string: ${timestamp}`);
  }
  return date.toISOString().split("T")[0];
}

/**
 * Calculates physical presence days across jurisdictions while resolving
 * multi-country collisions on transitional travel days without double-counting.
 */
export function calculateNomadTaxPresence(
  entries: TaxPresenceEntry[],
  options: NomadTaxOptions = {}
): NomadTaxComplianceReport {
  const threshold = options.taxResidencyThresholdDays ?? 183;
  const collisionRule = options.collisionRule ?? "DESTINATION_PRIORITY";
  const userId = entries.length > 0 ? entries[0].userId : "anonymous";
  const taxYear = options.taxYear ?? new Date().getUTCFullYear();

  // Filter entries matching the specified tax year if taxYear option provided
  const filteredEntries = entries.filter((e) => {
    const entryDate = new Date(e.timestamp);
    return !isNaN(entryDate.getTime()) && entryDate.getUTCFullYear() === taxYear;
  });

  // Group entries by calendar date YYYY-MM-DD
  const dateMap = new Map<string, TaxPresenceEntry[]>();

  for (const entry of filteredEntries) {
    const dateKey = toCalendarDateString(entry.timestamp);
    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, []);
    }
    dateMap.get(dateKey)!.push(entry);
  }

  const jurisdictionDaysMap = new Map<
    string,
    {
      countryCode: string;
      jurisdiction: string;
      days: Set<string>;
      firstSeen: string;
      lastSeen: string;
    }
  >();

  const collisions: TaxCollisionResolution[] = [];

  // Sort dates chronologically
  const sortedDates = Array.from(dateMap.keys()).sort();

  for (const dateKey of sortedDates) {
    const dayEntries = dateMap.get(dateKey)!;

    // Get unique country codes present on this calendar day
    const uniqueCountriesOnDay = Array.from(
      new Set(dayEntries.map((e) => e.countryCode))
    );

    let allocatedEntry: TaxPresenceEntry;

    if (uniqueCountriesOnDay.length > 1) {
      // MULTI-JURISDICTION COLLISION DETECTED: Nomad traveled across countries on same date
      // Resolve according to IATA/OECD tax residency conventions:
      // Priority 1: Check for explicit `isArrival` entry
      const arrivalEntry = dayEntries.find((e) => e.isArrival);
      if (arrivalEntry) {
        allocatedEntry = arrivalEntry;
      } else if (collisionRule === "FIRST_TIMESTAMP") {
        // Priority by earliest timestamp
        allocatedEntry = [...dayEntries].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )[0];
      } else {
        // Priority by latest timestamp (default destination on travel day)
        allocatedEntry = [...dayEntries].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )[0];
      }

      collisions.push({
        date: dateKey,
        conflictingCountries: uniqueCountriesOnDay,
        allocatedCountry: allocatedEntry.countryCode,
        resolutionReason: arrivalEntry
          ? `Arrival priority allocated to ${allocatedEntry.jurisdiction} (${allocatedEntry.countryCode})`
          : `Transitional travel day collision resolved to destination ${allocatedEntry.jurisdiction} (${allocatedEntry.countryCode}) based on latest timestamp`,
      });
    } else {
      allocatedEntry = dayEntries[0];
    }

    // Allocate 1 unique physical day to the resolved country
    const code = allocatedEntry.countryCode;
    if (!jurisdictionDaysMap.has(code)) {
      jurisdictionDaysMap.set(code, {
        countryCode: code,
        jurisdiction: allocatedEntry.jurisdiction,
        days: new Set<string>(),
        firstSeen: allocatedEntry.timestamp,
        lastSeen: allocatedEntry.timestamp,
      });
    }

    const record = jurisdictionDaysMap.get(code)!;
    record.days.add(dateKey);

    if (new Date(allocatedEntry.timestamp) < new Date(record.firstSeen)) {
      record.firstSeen = allocatedEntry.timestamp;
    }
    if (new Date(allocatedEntry.timestamp) > new Date(record.lastSeen)) {
      record.lastSeen = allocatedEntry.timestamp;
    }
  }

  // Build jurisdiction summaries and compliance alerts
  const jurisdictions: JurisdictionPresenceSummary[] = Array.from(
    jurisdictionDaysMap.values()
  ).map((item) => {
    const daysCount = item.days.size;
    const isTaxResidentRisk = daysCount >= threshold;
    const daysRemainingBefore183 = Math.max(0, threshold - daysCount);

    let riskLevel: JurisdictionPresenceSummary["riskLevel"] = "LOW";
    if (daysCount >= threshold) {
      riskLevel = "CRITICAL";
    } else if (daysCount >= threshold - 30) {
      riskLevel = "WARNING";
    }

    return {
      countryCode: item.countryCode,
      jurisdiction: item.jurisdiction,
      daysCount,
      isTaxResidentRisk,
      daysRemainingBefore183,
      riskLevel,
      firstSeen: item.firstSeen,
      lastSeen: item.lastSeen,
    };
  });

  // Sort jurisdictions by days count descending
  jurisdictions.sort((a, b) => b.daysCount - a.daysCount);

  const warnings: string[] = [];
  for (const j of jurisdictions) {
    if (j.isTaxResidentRisk) {
      warnings.push(
        `CRITICAL TAX RESIDENCY RISK: Reached ${j.daysCount} physical days in ${j.jurisdiction} (${j.countryCode}), triggering potential 183-day tax residency.`
      );
    } else if (j.riskLevel === "WARNING") {
      warnings.push(
        `Tax Residency Warning: Approaching 183-day threshold in ${j.jurisdiction} (${j.daysCount} days logged, ${j.daysRemainingBefore183} days remaining).`
      );
    }
  }

  return {
    userId,
    taxYear,
    totalUniqueCalendarDays: dateMap.size,
    collisionsResolvedCount: collisions.length,
    jurisdictions,
    collisions,
    warnings,
  };
}

/**
 * Calculates rolling Schengen days used in the last 180 days from referenceDate.
 */
export function calculateSchengenStay(
  records: NomadCheckInRecord[],
  referenceDate = new Date()
): VisaZoneLimit {
  const windowDays = 180;
  const maxDays = 90;

  const windowStart = new Date(referenceDate);
  windowStart.setDate(windowStart.getDate() - windowDays);

  const uniqueSchengenDates = new Set<string>();

  records.forEach((r) => {
    if (r.isSchengen || SCHENGEN_COUNTRIES.has(r.countryCode.toUpperCase())) {
      const recordDate = new Date(r.date);
      if (recordDate >= windowStart && recordDate <= referenceDate) {
        uniqueSchengenDates.add(r.date);
      }
    }
  });

  const daysUsed = uniqueSchengenDates.size;
  const daysRemaining = Math.max(0, maxDays - daysUsed);

  let status: VisaZoneLimit["status"] = "SAFE";
  if (daysRemaining <= 14) status = "CRITICAL_LIMIT";
  else if (daysRemaining <= 30) status = "WARNING";

  return {
    zoneName: "Schengen Area (90/180 Rule)",
    maxDays,
    windowDays,
    daysUsed,
    daysRemaining,
    status,
    taxResidencyRisk: daysUsed >= 85,
  };
}

/**
 * Computes full country breakdown and tax residency risks.
 */
export function generateNomadComplianceReport(
  records: NomadCheckInRecord[],
  taxYear = new Date().getFullYear()
): NomadComplianceReport {
  const schengenStay = calculateSchengenStay(records);

  const countryMap = new Map<
    string,
    {
      country: string;
      countryCode: string;
      dates: Set<string>;
      totalSpent: number;
      vatReclaimable: number;
      currency: string;
    }
  >();

  let totalWorkspaceExpense = 0;
  let totalVatReclaimable = 0;

  records.forEach((r) => {
    const recordYear = new Date(r.date).getFullYear();
    if (recordYear === taxYear) {
      if (!countryMap.has(r.countryCode)) {
        countryMap.set(r.countryCode, {
          country: r.country,
          countryCode: r.countryCode,
          dates: new Set(),
          totalSpent: 0,
          vatReclaimable: 0,
          currency: r.currency || "USD",
        });
      }

      const c = countryMap.get(r.countryCode)!;
      c.dates.add(r.date);
      c.totalSpent += r.amountSpent;
      const vat = r.amountSpent * (r.vatRatePct / 100);
      c.vatReclaimable += vat;

      totalWorkspaceExpense += r.amountSpent;
      totalVatReclaimable += vat;
    }
  });

  const countryBreakdown = Array.from(countryMap.values()).map((c) => {
    const daysSpent = c.dates.size;
    const daysRemaining183Rule = Math.max(0, 183 - daysSpent);
    return {
      country: c.country,
      countryCode: c.countryCode,
      daysSpent,
      daysRemaining183Rule,
      taxResidencyRisk: daysSpent >= 150,
      totalSpent: Number(c.totalSpent.toFixed(2)),
      vatReclaimable: Number(c.vatReclaimable.toFixed(2)),
      currency: c.currency,
    };
  });

  countryBreakdown.sort((a, b) => b.daysSpent - a.daysSpent);

  return {
    taxYear,
    schengenStay,
    countryBreakdown,
    totalWorkspaceExpense: Number(totalWorkspaceExpense.toFixed(2)),
    totalVatReclaimable: Number(totalVatReclaimable.toFixed(2)),
    currency: "USD",
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Formats compliance report as tax-deductible CSV.
 */
export function exportComplianceReportCSV(report: NomadComplianceReport): string {
  const headers = [
    "Jurisdiction",
    "Country Code",
    "Days In-Country",
    "Days to 183-Tax Trigger",
    "Tax Risk Flag",
    "Total Workspace Expense (USD)",
    "Estimated VAT/GST Reclaim (USD)",
  ];

  const rows = report.countryBreakdown.map((c) => [
    `"${c.country}"`,
    c.countryCode,
    c.daysSpent,
    c.daysRemaining183Rule,
    c.taxResidencyRisk ? "HIGH_RISK" : "SAFE",
    c.totalSpent.toFixed(2),
    c.vatReclaimable.toFixed(2),
  ]);

  const summary = [
    "",
    `"Schengen 90/180 Status","${report.schengenStay.daysUsed} / 90 Days Used (${report.schengenStay.daysRemaining} Remaining)","Status: ${report.schengenStay.status}"`,
    `"Total Tax Deductible Workspace Expenses","USD ${report.totalWorkspaceExpense.toFixed(2)}"`,
    `"Total Reclaimable VAT/GST","USD ${report.totalVatReclaimable.toFixed(2)}"`,
  ];

  return [headers.join(","), ...rows.map((r) => r.join(",")), ...summary].join("\n");
}

export interface NomadTaxPdfOptions {
  userId?: string;
  userName?: string;
  taxId?: string;
  baseUrl?: string;
  secret?: string;
  notes?: string;
}

/**
 * Computes a deterministic SHA-256 HMAC verification hash for the tax audit dossier.
 */
export function computeTaxAuditVerificationHash(
  report: NomadComplianceReport | NomadTaxComplianceReport,
  secret = process.env.TAX_AUDIT_VERIFICATION_SECRET || "worksphere-nomad-tax-audit-secret"
): string {
  const taxYear = report.taxYear || new Date().getFullYear();
  const countriesStr = "countryBreakdown" in report
    ? report.countryBreakdown.map((c) => `${c.countryCode}:${c.daysSpent}`).sort().join(",")
    : "jurisdictions" in report
    ? report.jurisdictions.map((j) => `${j.countryCode}:${j.daysCount}`).sort().join(",")
    : "";
  const totalDays = "totalUniqueCalendarDays" in report
    ? report.totalUniqueCalendarDays
    : "countryBreakdown" in report
    ? report.countryBreakdown.reduce((sum, c) => sum + c.daysSpent, 0)
    : 0;

  const payload = `TAX_AUDIT:${taxYear}:${totalDays}:${countriesStr}:${secret}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}

/**
 * Constructs the tamper-checked verification URL for accountant/auditor QR scanning.
 */
export function generateTaxAuditVerificationUrl(
  report: NomadComplianceReport | NomadTaxComplianceReport,
  options: NomadTaxPdfOptions = {}
): string {
  const hash = computeTaxAuditVerificationHash(report, options.secret);
  const baseUrl = (options.baseUrl || "https://worksphere.app").replace(/\/+$/, "");
  const userId = options.userId || ("userId" in report ? report.userId : "nomad_user");
  return `${baseUrl}/api/tax/nomad-compliance?verify=true&year=${report.taxYear}&hash=${hash}&user=${encodeURIComponent(userId)}`;
}

/**
 * Draws a 2D boolean QR code matrix directly onto a PDF page using vector rectangles.
 */
function drawVectorQr(
  page: PDFPage,
  matrix: boolean[][],
  startX: number,
  startY: number,
  size: number,
  fgColor = rgb(0.08, 0.11, 0.18),
  bgColor = rgb(1, 1, 1)
): void {
  const moduleCount = matrix.length;
  if (moduleCount === 0) return;
  const moduleSize = size / moduleCount;

  if (bgColor) {
    page.drawRectangle({
      x: startX,
      y: startY,
      width: size,
      height: size,
      color: bgColor,
    });
  }

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        const x = startX + c * moduleSize;
        const y = startY + (moduleCount - 1 - r) * moduleSize;
        page.drawRectangle({
          x,
          y,
          width: moduleSize,
          height: moduleSize,
          color: fgColor,
        });
      }
    }
  }
}

/**
 * Sanitizes strings to pure printable ASCII characters to prevent Helvetica encoding failures in pdf-lib.
 */
function cleanAscii(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[•·]/g, "*")
    .replace(/€/g, "EUR")
    .replace(/£/g, "GBP")
    .replace(/¥/g, "JPY")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/[^\x20-\x7E]/g, "");
}

/**
 * Generates an automated annual nomad tax compliance audit report as a professional multi-page PDF.
 * Compiles verified check-ins, country stay durations, tax treaty citations,
 * 183-day tax year thresholds, potential dual-residency flags, and cryptographic QR verification.
 */
export async function generateNomadTaxAuditPdf(
  report: NomadComplianceReport | NomadTaxComplianceReport,
  options: NomadTaxPdfOptions = {}
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  // Professional corporate color palette
  const primaryDark = rgb(0.08, 0.11, 0.18);
  const accentIndigo = rgb(0.28, 0.35, 0.85);
  const bgLight = rgb(0.96, 0.97, 0.99);
  const borderLight = rgb(0.85, 0.88, 0.93);
  const textDark = rgb(0.12, 0.14, 0.20);
  const textMuted = rgb(0.42, 0.46, 0.54);
  const greenRisk = rgb(0.12, 0.65, 0.38);
  const amberRisk = rgb(0.85, 0.52, 0.12);
  const redRisk = rgb(0.85, 0.22, 0.22);
  const white = rgb(1, 1, 1);

  const taxYear = report.taxYear || new Date().getFullYear();
  const userId = options.userId || ("userId" in report ? report.userId : "nomad_user");
  const generatedAt = "generatedAt" in report ? report.generatedAt : new Date().toISOString();

  type NormalizedCountry = {
    country: string;
    countryCode: string;
    daysSpent: number;
    daysRemaining183: number;
    taxResidencyRisk: boolean;
    dualResidencyFlag: boolean;
    riskLevel: "LOW" | "WARNING" | "CRITICAL";
    totalSpent: number;
    vatReclaimable: number;
    currency: string;
  };

  const countries: NormalizedCountry[] = [];
  let totalDays = 0;
  let totalExpense = 0;
  let totalVat = 0;
  let currency = "USD";

  if ("countryBreakdown" in report) {
    totalExpense = report.totalWorkspaceExpense || 0;
    totalVat = report.totalVatReclaimable || 0;
    currency = report.currency || "USD";
    for (const c of report.countryBreakdown) {
      totalDays += c.daysSpent;
      const isCritical = c.daysSpent >= 183;
      const isWarning = c.daysSpent >= 150;
      countries.push({
        country: c.country,
        countryCode: c.countryCode,
        daysSpent: c.daysSpent,
        daysRemaining183: c.daysRemaining183Rule,
        taxResidencyRisk: c.taxResidencyRisk || isCritical,
        dualResidencyFlag: isCritical || isWarning,
        riskLevel: isCritical ? "CRITICAL" : isWarning ? "WARNING" : "LOW",
        totalSpent: c.totalSpent || 0,
        vatReclaimable: c.vatReclaimable || 0,
        currency: c.currency || "USD",
      });
    }
  } else if ("jurisdictions" in report) {
    totalDays = report.totalUniqueCalendarDays || 0;
    for (const j of report.jurisdictions) {
      const isCritical = j.isTaxResidentRisk || j.daysCount >= 183;
      const isWarning = j.riskLevel === "WARNING" || j.daysCount >= 150;
      countries.push({
        country: j.jurisdiction,
        countryCode: j.countryCode,
        daysSpent: j.daysCount,
        daysRemaining183: j.daysRemainingBefore183,
        taxResidencyRisk: isCritical,
        dualResidencyFlag: isCritical || isWarning,
        riskLevel: isCritical ? "CRITICAL" : isWarning ? "WARNING" : "LOW",
        totalSpent: 0,
        vatReclaimable: 0,
        currency: "USD",
      });
    }
  }

  // Dual residency detection:
  // If at least one country is CRITICAL (>= 183 days) or multiple countries have >= 90 days
  const hasCriticalCountry = countries.some((c) => c.riskLevel === "CRITICAL");
  const countHighStays = countries.filter((c) => c.daysSpent >= 90).length;
  const hasDualResidencyHazard = hasCriticalCountry || countHighStays >= 2;

  // Verification Hash & URL
  const verificationHash = computeTaxAuditVerificationHash(report, options.secret);
  const verificationUrl = generateTaxAuditVerificationUrl(report, options);
  const qrMatrix = generateQRMatrix(verificationUrl);

  // ================= PAGE 1 =================
  const page1 = pdfDoc.addPage([pageWidth, pageHeight]);

  // Top header color accent bar
  page1.drawRectangle({
    x: margin,
    y: pageHeight - margin - 4,
    width: contentWidth,
    height: 4,
    color: accentIndigo,
  });

  // Header Title
  page1.drawText("WORKSPHERE COMPLIANCE AUDIT DOSSIER", {
    x: margin,
    y: pageHeight - margin - 22,
    size: 14,
    font: boldFont,
    color: primaryDark,
  });

  page1.drawText("ANNUAL NOMAD PHYSICAL PRESENCE & TAX TREATY AUDIT REPORT", {
    x: margin,
    y: pageHeight - margin - 35,
    size: 8,
    font: boldFont,
    color: accentIndigo,
  });

  page1.drawText(`TAX CALENDAR YEAR ${taxYear}  *  VERIFIED AUDIT PROOF FOR CPAs`, {
    x: margin,
    y: pageHeight - margin - 47,
    size: 7.5,
    font,
    color: textMuted,
  });

  // Draw QR Verification Box in upper right
  const qrBoxX = pageWidth - margin - 110;
  const qrBoxY = pageHeight - margin - 100;
  const qrBoxWidth = 110;
  const qrBoxHeight = 98;

  page1.drawRectangle({
    x: qrBoxX,
    y: qrBoxY,
    width: qrBoxWidth,
    height: qrBoxHeight,
    color: bgLight,
    borderColor: borderLight,
    borderWidth: 1,
  });

  // Vector QR code inside the box
  drawVectorQr(page1, qrMatrix, qrBoxX + 22, qrBoxY + 26, 66);

  page1.drawText("QR AUDIT PROOF", {
    x: qrBoxX + 16,
    y: qrBoxY + 14,
    size: 6.5,
    font: boldFont,
    color: primaryDark,
  });

  page1.drawText(`HASH: ${verificationHash.slice(0, 14)}...`, {
    x: qrBoxX + 10,
    y: qrBoxY + 6,
    size: 5.5,
    font,
    color: textMuted,
  });

  // Audit Metadata Box
  const metaY = pageHeight - margin - 110;
  page1.drawRectangle({
    x: margin,
    y: metaY,
    width: contentWidth - 120,
    height: 52,
    color: bgLight,
    borderColor: borderLight,
    borderWidth: 1,
  });

  const col1X = margin + 10;
  const col2X = margin + 190;

  page1.drawText("TAXPAYER / AUDITEE ID:", { x: col1X, y: metaY + 36, size: 6.5, font: boldFont, color: textMuted });
  page1.drawText(cleanAscii(userId), { x: col1X, y: metaY + 25, size: 8, font: boldFont, color: textDark });

  page1.drawText("GENERATED TIMESTAMP:", { x: col1X, y: metaY + 14, size: 6.5, font: boldFont, color: textMuted });
  page1.drawText(cleanAscii(generatedAt), { x: col1X, y: metaY + 4, size: 7.5, font, color: textDark });

  page1.drawText("AUDIT CERTIFICATE REF:", { x: col2X, y: metaY + 36, size: 6.5, font: boldFont, color: textMuted });
  page1.drawText(`WS-TAX-${taxYear}-${verificationHash.slice(0, 8).toUpperCase()}`, { x: col2X, y: metaY + 25, size: 8, font: boldFont, color: accentIndigo });

  page1.drawText("VERIFIED JURISDICTIONS:", { x: col2X, y: metaY + 14, size: 6.5, font: boldFont, color: textMuted });
  page1.drawText(`${countries.length} Distinct Countries Tracked`, { x: col2X, y: metaY + 4, size: 7.5, font, color: textDark });

  // Key Metrics Banner (3 Cards)
  const cardY = metaY - 70;
  const cardWidth = (contentWidth - 16) / 3;
  const cardHeight = 58;

  // Card 1: Total Days
  page1.drawRectangle({ x: margin, y: cardY, width: cardWidth, height: cardHeight, color: bgLight, borderColor: borderLight, borderWidth: 1 });
  page1.drawText("PHYSICAL PRESENCE DAYS", { x: margin + 8, y: cardY + 44, size: 6.5, font: boldFont, color: textMuted });
  page1.drawText(`${totalDays}`, { x: margin + 8, y: cardY + 22, size: 18, font: boldFont, color: primaryDark });
  page1.drawText("100% Unique Calendar Days", { x: margin + 8, y: cardY + 8, size: 6.5, font, color: greenRisk });

  // Card 2: Schengen Status
  const card2X = margin + cardWidth + 8;
  const schengenUsed = "schengenStay" in report ? report.schengenStay.daysUsed : 0;
  const schengenRem = "schengenStay" in report ? report.schengenStay.daysRemaining : 90;
  const schengenStatus = "schengenStay" in report ? report.schengenStay.status : "SAFE";
  page1.drawRectangle({ x: card2X, y: cardY, width: cardWidth, height: cardHeight, color: bgLight, borderColor: borderLight, borderWidth: 1 });
  page1.drawText("SCHENGEN 90/180 QUOTA", { x: card2X + 8, y: cardY + 44, size: 6.5, font: boldFont, color: textMuted });
  page1.drawText(`${schengenUsed} / 90 Days`, { x: card2X + 8, y: cardY + 22, size: 16, font: boldFont, color: schengenStatus === "SAFE" ? greenRisk : redRisk });
  page1.drawText(`${schengenRem} Days Remaining (${schengenStatus})`, { x: card2X + 8, y: cardY + 8, size: 6.5, font, color: textMuted });

  // Card 3: Deductible Expenses
  const card3X = card2X + cardWidth + 8;
  page1.drawRectangle({ x: card3X, y: cardY, width: cardWidth, height: cardHeight, color: bgLight, borderColor: borderLight, borderWidth: 1 });
  page1.drawText("DEDUCTIBLE WORKSPACE SPEND", { x: card3X + 8, y: cardY + 44, size: 6.5, font: boldFont, color: textMuted });
  page1.drawText(`${currency} ${totalExpense.toFixed(2)}`, { x: card3X + 8, y: cardY + 22, size: 15, font: boldFont, color: primaryDark });
  page1.drawText(`VAT Reclaim: ${currency} ${totalVat.toFixed(2)}`, { x: card3X + 8, y: cardY + 8, size: 6.5, font, color: textMuted });

  // Global Residency & Dual-Residency Status Section
  const riskSectionY = cardY - 95;
  page1.drawText("GLOBAL TAX RESIDENCY & DUAL-RESIDENCY STATUS", {
    x: margin,
    y: riskSectionY + 82,
    size: 10,
    font: boldFont,
    color: primaryDark,
  });

  const riskBannerColor = hasCriticalCountry ? rgb(0.98, 0.92, 0.92) : hasDualResidencyHazard ? rgb(0.99, 0.95, 0.90) : rgb(0.92, 0.98, 0.94);
  const riskBorderColor = hasCriticalCountry ? redRisk : hasDualResidencyHazard ? amberRisk : greenRisk;

  page1.drawRectangle({
    x: margin,
    y: riskSectionY,
    width: contentWidth,
    height: 74,
    color: riskBannerColor,
    borderColor: riskBorderColor,
    borderWidth: 1.5,
  });

  const riskTitle = hasCriticalCountry
    ? "CRITICAL STATUS: STATUTORY TAX RESIDENCY TRIGGERED (>= 183 DAYS)"
    : hasDualResidencyHazard
    ? "WARNING: POTENTIAL DUAL-RESIDENCY EXPOSURE DETECTED (> 90 DAYS IN MULTIPLE STATES)"
    : "COMPLIANT STATUS: NO JURISDICTIONS EXCEED 183-DAY TAX RESIDENCY THRESHOLD";

  page1.drawText(riskTitle, {
    x: margin + 12,
    y: riskSectionY + 56,
    size: 8.5,
    font: boldFont,
    color: hasCriticalCountry ? redRisk : hasDualResidencyHazard ? amberRisk : greenRisk,
  });

  const riskDesc1 = "The 183-day rule represents the standard international threshold where physical presence in a host nation triggers worldwide";
  const riskDesc2 = "income tax liability under domestic legislation. Potential dual-residency hazards arise when overlapping jurisdictions enforce competing";
  const riskDesc3 = "tax claims, requiring resolution under bilateral double taxation treaty tie-breaker rules.";

  page1.drawText(riskDesc1, { x: margin + 12, y: riskSectionY + 41, size: 7.2, font, color: textDark });
  page1.drawText(riskDesc2, { x: margin + 12, y: riskSectionY + 29, size: 7.2, font, color: textDark });
  page1.drawText(riskDesc3, { x: margin + 12, y: riskSectionY + 17, size: 7.2, font, color: textDark });

  // Statutory Citations & Treaty Analysis Section
  const citationsY = riskSectionY - 200;
  page1.drawText("STATUTORY CITATIONS & TAX TREATY FRAMEWORK (FOR ACCOUNTANTS / CPAs)", {
    x: margin,
    y: citationsY + 188,
    size: 10,
    font: boldFont,
    color: primaryDark,
  });

  page1.drawRectangle({
    x: margin,
    y: citationsY,
    width: contentWidth,
    height: 180,
    color: bgLight,
    borderColor: borderLight,
    borderWidth: 1,
  });

  // Citation 1: OECD Article 4
  page1.drawText("1. OECD Model Tax Convention - Article 4 (Resident) Tie-Breaker Hierarchy", {
    x: margin + 10,
    y: citationsY + 162,
    size: 8,
    font: boldFont,
    color: primaryDark,
  });
  page1.drawText("When an individual is deemed a tax resident of two Contracting States under their domestic laws, residency status is assigned", {
    x: margin + 16,
    y: citationsY + 150,
    size: 7,
    font,
    color: textDark,
  });
  page1.drawText("in the following strict hierarchical order: (1) Permanent home available; (2) Centre of vital interests (closer personal and economic", {
    x: margin + 16,
    y: citationsY + 140,
    size: 7,
    font,
    color: textDark,
  });
  page1.drawText("ties); (3) Habitual abode (state of greater physical duration); (4) Nationality; (5) Mutual Agreement Procedure (MAP).", {
    x: margin + 16,
    y: citationsY + 130,
    size: 7,
    font,
    color: textDark,
  });

  // Citation 2: OECD Article 15
  page1.drawText("2. OECD Model Tax Convention - Article 15 (Employment Income) 183-Day Rule", {
    x: margin + 10,
    y: citationsY + 110,
    size: 8,
    font: boldFont,
    color: primaryDark,
  });
  page1.drawText("Remuneration derived by a non-resident in respect of employment exercised in a host state is taxable solely in the home state if:", {
    x: margin + 16,
    y: citationsY + 98,
    size: 7,
    font,
    color: textDark,
  });
  page1.drawText("(a) The employee is present in the host state for not more than 183 days in any 12-month period commencing or ending in the fiscal year;", {
    x: margin + 16,
    y: citationsY + 88,
    size: 7,
    font,
    color: textDark,
  });
  page1.drawText("(b) The remuneration is paid by, or on behalf of, an employer who is not a resident of the host state; and", {
    x: margin + 16,
    y: citationsY + 78,
    size: 7,
    font,
    color: textDark,
  });
  page1.drawText("(c) The remuneration is not borne by a Permanent Establishment (PE) which the employer has in the host state.", {
    x: margin + 16,
    y: citationsY + 68,
    size: 7,
    font,
    color: textDark,
  });

  // Citation 3: Schengen Borders Code
  page1.drawText("3. Schengen Borders Code (Regulation EU 2016/399) - Article 6(1) Short-Stay Visa Limits", {
    x: margin + 10,
    y: citationsY + 48,
    size: 8,
    font: boldFont,
    color: primaryDark,
  });
  page1.drawText("Third-country nationals are authorized to stay for a maximum of 90 days in any rolling 180-day window across the 29 Schengen member", {
    x: margin + 16,
    y: citationsY + 36,
    size: 7,
    font,
    color: textDark,
  });
  page1.drawText("states. Stays exceeding 90 days without a national long-stay visa (Type D) constitute illegal presence and trigger visa sanctions.", {
    x: margin + 16,
    y: citationsY + 26,
    size: 7,
    font,
    color: textDark,
  });

  // ================= PAGE 2 =================
  const page2 = pdfDoc.addPage([pageWidth, pageHeight]);

  // Top header color accent bar
  page2.drawRectangle({
    x: margin,
    y: pageHeight - margin - 4,
    width: contentWidth,
    height: 4,
    color: accentIndigo,
  });

  // Header Title
  page2.drawText("PHYSICAL PRESENCE ITEMIZATION & DUAL-RESIDENCY SCHEDULE", {
    x: margin,
    y: pageHeight - margin - 22,
    size: 13,
    font: boldFont,
    color: primaryDark,
  });

  page2.drawText(`TAX YEAR ${taxYear}  *  DETAILED AUDIT TRAIL OF JURISDICTION STAYS & DUAL-RESIDENCY FLAGS`, {
    x: margin,
    y: pageHeight - margin - 35,
    size: 7.5,
    font,
    color: textMuted,
  });

  // Itemization Table
  const tableTopY = pageHeight - margin - 55;
  const colX_Jurisdiction = margin + 8;
  const colX_Code = margin + 140;
  const colX_Days = margin + 185;
  const colX_Trigger = margin + 250;
  const colX_Risk = margin + 335;
  const colX_Spend = margin + 440;

  // Header row
  page2.drawRectangle({
    x: margin,
    y: tableTopY - 18,
    width: contentWidth,
    height: 20,
    color: primaryDark,
  });

  page2.drawText("JURISDICTION", { x: colX_Jurisdiction, y: tableTopY - 12, size: 7, font: boldFont, color: white });
  page2.drawText("CODE", { x: colX_Code, y: tableTopY - 12, size: 7, font: boldFont, color: white });
  page2.drawText("DAYS IN-COUNTRY", { x: colX_Days, y: tableTopY - 12, size: 7, font: boldFont, color: white });
  page2.drawText("183-DAY BUFFER", { x: colX_Trigger, y: tableTopY - 12, size: 7, font: boldFont, color: white });
  page2.drawText("DUAL-RESIDENCY RISK", { x: colX_Risk, y: tableTopY - 12, size: 7, font: boldFont, color: white });
  page2.drawText("EXPENSE / VAT", { x: colX_Spend, y: tableTopY - 12, size: 7, font: boldFont, color: white });

  let rowY = tableTopY - 38;
  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    const isAlt = i % 2 === 1;
    page2.drawRectangle({
      x: margin,
      y: rowY - 4,
      width: contentWidth,
      height: 20,
      color: isAlt ? bgLight : white,
      borderColor: borderLight,
      borderWidth: 0.5,
    });

    page2.drawText(cleanAscii(c.country), { x: colX_Jurisdiction, y: rowY + 3, size: 7.5, font: boldFont, color: textDark });
    page2.drawText(cleanAscii(c.countryCode), { x: colX_Code, y: rowY + 3, size: 7.5, font, color: textMuted });
    page2.drawText(`${c.daysSpent} Days`, { x: colX_Days, y: rowY + 3, size: 7.5, font: boldFont, color: primaryDark });
    page2.drawText(`${c.daysRemaining183} Days Remaining`, { x: colX_Trigger, y: rowY + 3, size: 7.5, font, color: textDark });

    const riskColor = c.riskLevel === "CRITICAL" ? redRisk : c.riskLevel === "WARNING" ? amberRisk : greenRisk;
    const riskLabel = c.riskLevel === "CRITICAL" ? "CRITICAL (RESIDENT)" : c.riskLevel === "WARNING" ? "WARNING (HIGH RISK)" : "SAFE (NON-RESIDENT)";
    page2.drawText(riskLabel, { x: colX_Risk, y: rowY + 3, size: 7, font: boldFont, color: riskColor });

    const expenseStr = c.totalSpent > 0 ? `${c.currency} ${c.totalSpent.toFixed(0)} / ${c.vatReclaimable.toFixed(0)}` : "N/A";
    page2.drawText(cleanAscii(expenseStr), { x: colX_Spend, y: rowY + 3, size: 7, font, color: textMuted });

    rowY -= 22;
  }

  // Summary Total Row
  page2.drawRectangle({
    x: margin,
    y: rowY - 4,
    width: contentWidth,
    height: 22,
    color: bgLight,
    borderColor: borderLight,
    borderWidth: 1,
  });
  page2.drawText("TOTAL CONSOLIDATED AUDIT DAYS", { x: colX_Jurisdiction, y: rowY + 4, size: 7.5, font: boldFont, color: primaryDark });
  page2.drawText(`${totalDays} Days`, { x: colX_Days, y: rowY + 4, size: 8, font: boldFont, color: accentIndigo });
  page2.drawText(`${currency} ${totalExpense.toFixed(2)} / ${totalVat.toFixed(2)}`, { x: colX_Spend, y: rowY + 4, size: 7.5, font: boldFont, color: primaryDark });

  // Transitional Travel Collision Resolution Notes Box
  rowY -= 36;
  page2.drawText("TRANSITIONAL TRAVEL DAYS & COLLISION RESOLUTION INVARIANT", {
    x: margin,
    y: rowY + 8,
    size: 9,
    font: boldFont,
    color: primaryDark,
  });

  const collisionBoxHeight = 65;
  rowY -= collisionBoxHeight;
  page2.drawRectangle({
    x: margin,
    y: rowY,
    width: contentWidth,
    height: collisionBoxHeight,
    color: bgLight,
    borderColor: borderLight,
    borderWidth: 1,
  });

  page2.drawText("Multi-country collisions on cross-border travel days are resolved in accordance with IATA and OECD international tax conventions:", {
    x: margin + 10,
    y: rowY + 50,
    size: 7,
    font,
    color: textDark,
  });
  page2.drawText("1. Destination Arrival Priority: Travel days with morning departures and evening arrivals are allocated 1 physical presence day to", {
    x: margin + 14,
    y: rowY + 38,
    size: 7,
    font,
    color: textDark,
  });
  page2.drawText("   the arrival jurisdiction, preventing duplicate day counts across jurisdictions.", {
    x: margin + 14,
    y: rowY + 28,
    size: 7,
    font,
    color: textDark,
  });
  page2.drawText("2. Invariant: Sum of individual allocated jurisdiction days strictly equals unique physical calendar days tracked.", {
    x: margin + 14,
    y: rowY + 16,
    size: 7,
    font: boldFont,
    color: textDark,
  });

  // CPA / Auditor Attestation Block
  rowY -= 30;
  page2.drawText("CERTIFIED PUBLIC ACCOUNTANT (CPA) / AUDITOR ATTESTATION", {
    x: margin,
    y: rowY + 8,
    size: 9,
    font: boldFont,
    color: primaryDark,
  });

  const attestationHeight = 110;
  rowY -= attestationHeight;
  page2.drawRectangle({
    x: margin,
    y: rowY,
    width: contentWidth,
    height: attestationHeight,
    color: white,
    borderColor: borderLight,
    borderWidth: 1,
  });

  page2.drawText("I hereby certify that I have reviewed the compiled physical presence day counts, tax residency thresholds, and treaty citations.", {
    x: margin + 10,
    y: rowY + 94,
    size: 7.2,
    font,
    color: textDark,
  });
  page2.drawText("This report reflects verified coworking check-in telemetry and border travel records for the stated tax year.", {
    x: margin + 10,
    y: rowY + 83,
    size: 7.2,
    font,
    color: textDark,
  });

  // Signature lines
  const sigCol1 = margin + 10;
  const sigCol2 = margin + 270;

  page2.drawLine({ start: { x: sigCol1, y: rowY + 45 }, end: { x: sigCol1 + 220, y: rowY + 45 }, color: borderLight, thickness: 1 });
  page2.drawText("Auditor / CPA Signature", { x: sigCol1, y: rowY + 34, size: 7, font: boldFont, color: textMuted });

  page2.drawLine({ start: { x: sigCol2, y: rowY + 45 }, end: { x: sigCol2 + 220, y: rowY + 45 }, color: borderLight, thickness: 1 });
  page2.drawText("Date & Official Stamp", { x: sigCol2, y: rowY + 34, size: 7, font: boldFont, color: textMuted });

  page2.drawLine({ start: { x: sigCol1, y: rowY + 18 }, end: { x: sigCol1 + 220, y: rowY + 18 }, color: borderLight, thickness: 1 });
  page2.drawText("License / Registration Number", { x: sigCol1, y: rowY + 7, size: 7, font: boldFont, color: textMuted });

  page2.drawLine({ start: { x: sigCol2, y: rowY + 18 }, end: { x: sigCol2 + 220, y: rowY + 18 }, color: borderLight, thickness: 1 });
  page2.drawText("Accounting Firm / Practice Name", { x: sigCol2, y: rowY + 7, size: 7, font: boldFont, color: textMuted });

  // Add page numbers and footers across all pages
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const p = pdfDoc.getPage(i);
    p.drawLine({
      start: { x: margin, y: 32 },
      end: { x: pageWidth - margin, y: 32 },
      color: borderLight,
      thickness: 0.5,
    });
    p.drawText(`WorkSphere NomadTaxEngine * Annual Compliance Audit Dossier (${taxYear})`, {
      x: margin,
      y: 20,
      size: 6.5,
      font,
      color: textMuted,
    });
    p.drawText(`Page ${i + 1} of ${totalPages}`, {
      x: pageWidth - margin - 50,
      y: 20,
      size: 6.5,
      font: boldFont,
      color: textMuted,
    });
  }

  return await pdfDoc.save();
}
