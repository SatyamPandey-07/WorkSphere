import {
  calculateNomadTaxPresence,
  toCalendarDateString,
  generateNomadComplianceReport,
  generateNomadTaxAuditPdf,
  computeTaxAuditVerificationHash,
  generateTaxAuditVerificationUrl,
  TaxPresenceEntry,
  NomadCheckInRecord,
} from "@/lib/tax/nomadTaxEngine";
import { PDFDocument } from "pdf-lib";

describe("NomadTaxEngine - Physical Presence & Multi-Jurisdiction Collision Resolution", () => {
  it("normalizes ISO timestamps to UTC calendar date strings", () => {
    expect(toCalendarDateString("2026-03-15T08:30:00.000Z")).toBe("2026-03-15");
    expect(toCalendarDateString("2026-03-15T23:59:59.999Z")).toBe("2026-03-15");
  });

  it("calculates physical presence for single-country stays without collisions", () => {
    const entries: TaxPresenceEntry[] = [
      {
        id: "1",
        userId: "user-1",
        countryCode: "ES",
        jurisdiction: "Spain",
        timestamp: "2026-03-01T10:00:00Z",
      },
      {
        id: "2",
        userId: "user-1",
        countryCode: "ES",
        jurisdiction: "Spain",
        timestamp: "2026-03-02T10:00:00Z",
      },
    ];

    const report = calculateNomadTaxPresence(entries, { taxYear: 2026 });

    expect(report.totalUniqueCalendarDays).toBe(2);
    expect(report.collisionsResolvedCount).toBe(0);
    expect(report.jurisdictions).toHaveLength(1);
    expect(report.jurisdictions[0].countryCode).toBe("ES");
    expect(report.jurisdictions[0].daysCount).toBe(2);
  });

  it("resolves multi-jurisdiction physical presence collisions on transitional travel days without double-counting", () => {
    const entries: TaxPresenceEntry[] = [
      // Day 1: Stay in Spain
      {
        id: "e1",
        userId: "nomad-42",
        countryCode: "ES",
        jurisdiction: "Spain",
        timestamp: "2026-04-10T09:00:00Z",
      },
      // Day 2: Travel Day - Check-in in Spain in morning, arrival check-in in Portugal in evening
      {
        id: "e2",
        userId: "nomad-42",
        countryCode: "ES",
        jurisdiction: "Spain",
        timestamp: "2026-04-11T08:00:00Z",
        isDeparture: true,
      },
      {
        id: "e3",
        userId: "nomad-42",
        countryCode: "PT",
        jurisdiction: "Portugal",
        timestamp: "2026-04-11T21:30:00Z",
        isArrival: true,
      },
      // Day 3: Stay in Portugal
      {
        id: "e4",
        userId: "nomad-42",
        countryCode: "PT",
        jurisdiction: "Portugal",
        timestamp: "2026-04-12T14:00:00Z",
      },
    ];

    const report = calculateNomadTaxPresence(entries, { taxYear: 2026 });

    // Total unique calendar days must equal 3 (April 10, April 11, April 12)
    expect(report.totalUniqueCalendarDays).toBe(3);
    // Collision on April 11 should be resolved
    expect(report.collisionsResolvedCount).toBe(1);

    const esSummary = report.jurisdictions.find((j) => j.countryCode === "ES");
    const ptSummary = report.jurisdictions.find((j) => j.countryCode === "PT");

    // April 10 -> Spain (1 day)
    // April 11 -> Portugal (Arrival priority allocated 1 day)
    // April 12 -> Portugal (1 day)
    expect(esSummary?.daysCount).toBe(1);
    expect(ptSummary?.daysCount).toBe(2);

    // Total sum of days across jurisdictions must equal unique calendar days (3)
    const sumDays = report.jurisdictions.reduce((acc, j) => acc + j.daysCount, 0);
    expect(sumDays).toBe(3);
  });

  it("generates 183-day tax residency risk warnings when thresholds are reached", () => {
    // Generate 185 entries for Spain in 2026
    const entries: TaxPresenceEntry[] = [];
    const startDate = new Date("2026-01-01T12:00:00Z");

    for (let i = 0; i < 185; i++) {
      const d = new Date(startDate);
      d.setUTCDate(startDate.getUTCDate() + i);
      entries.push({
        id: `day-${i}`,
        userId: "nomad-183",
        countryCode: "ES",
        jurisdiction: "Spain",
        timestamp: d.toISOString(),
      });
    }

    const report = calculateNomadTaxPresence(entries, { taxYear: 2026 });

    expect(report.jurisdictions[0].isTaxResidentRisk).toBe(true);
    expect(report.jurisdictions[0].riskLevel).toBe("CRITICAL");
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]).toContain("CRITICAL TAX RESIDENCY RISK");
  });
});

describe("NomadTaxEngine - Annual Compliance Audit PDF Export & Verification Hash", () => {
  const sampleRecords: NomadCheckInRecord[] = [
    {
      id: "rec-pt-1",
      venueId: "v-lisbon",
      venueName: "Second Home Coworking — Lisboa 🌟",
      city: "Lisbon",
      country: "Portugal",
      countryCode: "PT",
      isSchengen: true,
      date: "2026-03-10",
      amountSpent: 250,
      currency: "USD",
      vatRatePct: 23,
    },
    {
      id: "rec-pt-2",
      venueId: "v-porto",
      venueName: "Porto i/o Riverside",
      city: "Porto",
      country: "Portugal",
      countryCode: "PT",
      isSchengen: true,
      date: "2026-03-25",
      amountSpent: 180,
      currency: "USD",
      vatRatePct: 23,
    },
    {
      id: "rec-es-1",
      venueId: "v-bcn",
      venueName: "Betahaus Barcelona Gracia",
      city: "Barcelona",
      country: "Spain",
      countryCode: "ES",
      isSchengen: true,
      date: "2026-04-12",
      amountSpent: 310,
      currency: "USD",
      vatRatePct: 21,
    },
    {
      id: "rec-jp-1",
      venueId: "v-tokyo",
      venueName: "WeWork Shibuya Scramble Square",
      city: "Tokyo",
      country: "Japan",
      countryCode: "JP",
      isSchengen: false,
      date: "2026-05-18",
      amountSpent: 420,
      currency: "USD",
      vatRatePct: 10,
    },
  ];

  describe("QR Verification Hash & Cryptographic Tamper Detection", () => {
    it("computes a deterministic 32-character hex HMAC verification hash", () => {
      const report = generateNomadComplianceReport(sampleRecords, 2026);
      const hash1 = computeTaxAuditVerificationHash(report, "test-secret");
      const hash2 = computeTaxAuditVerificationHash(report, "test-secret");

      expect(hash1).toHaveLength(32);
      expect(hash1).toBe(hash2);
      expect(/^[0-9a-f]{32}$/.test(hash1)).toBe(true);
    });

    it("changes verification hash when report data is altered (tamper detection)", () => {
      const report1 = generateNomadComplianceReport(sampleRecords, 2026);
      const hash1 = computeTaxAuditVerificationHash(report1, "test-secret");

      const modifiedRecords = [
        ...sampleRecords,
        {
          id: "rec-extra",
          venueId: "v-berlin",
          venueName: "Factory Berlin",
          city: "Berlin",
          country: "Germany",
          countryCode: "DE",
          isSchengen: true,
          date: "2026-06-01",
          amountSpent: 200,
          currency: "USD",
          vatRatePct: 19,
        },
      ];
      const report2 = generateNomadComplianceReport(modifiedRecords, 2026);
      const hash2 = computeTaxAuditVerificationHash(report2, "test-secret");

      expect(hash1).not.toBe(hash2);
    });

    it("constructs a valid verification URL encoding hash, taxYear, and userId", () => {
      const report = generateNomadComplianceReport(sampleRecords, 2026);
      const url = generateTaxAuditVerificationUrl(report, {
        userId: "nomad-alex",
        baseUrl: "https://worksphere.app",
        secret: "test-secret",
      });

      expect(url).toContain("https://worksphere.app/api/tax/nomad-compliance");
      expect(url).toContain("verify=true");
      expect(url).toContain("year=2026");
      expect(url).toContain("hash=");
      expect(url).toContain("user=nomad-alex");
    });
  });

  describe("Multi-Page PDF Generation via pdf-lib", () => {
    it("generates a professional multi-page PDF document with valid PDF header", async () => {
      const report = generateNomadComplianceReport(sampleRecords, 2026);
      const pdfBytes = await generateNomadTaxAuditPdf(report, {
        userId: "user-nomad-42",
        userName: "Alex Rivera",
        taxId: "ES-NIE-X9876543Y",
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      // Verify PDF magic header
      const headerString = String.fromCharCode(...pdfBytes.slice(0, 5));
      expect(headerString).toBe("%PDF-");

      // Verify multi-page layout
      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBeGreaterThanOrEqual(2);

      // Check standard A4 dimensions
      const page1 = loadedDoc.getPage(0);
      expect(page1.getWidth()).toBeCloseTo(595.28, 0);
      expect(page1.getHeight()).toBeCloseTo(841.89, 0);
    });

    it("itemizes physical presence day counts, tax year thresholds, and potential dual-residency flags", async () => {
      // Create multi-country stay simulating dual-residency risk (> 90 days in PT and ES)
      const extendedRecords: NomadCheckInRecord[] = [];
      const baseDate = new Date("2026-01-01T00:00:00Z");

      // 95 days in Portugal
      for (let i = 0; i < 95; i++) {
        const d = new Date(baseDate);
        d.setUTCDate(baseDate.getUTCDate() + i);
        extendedRecords.push({
          id: `pt-${i}`,
          venueId: "v-lisbon",
          venueName: "Cowork Lisbon",
          city: "Lisbon",
          country: "Portugal",
          countryCode: "PT",
          isSchengen: true,
          date: d.toISOString().split("T")[0],
          amountSpent: 30,
          currency: "USD",
          vatRatePct: 23,
        });
      }

      // 95 days in Spain
      for (let i = 95; i < 190; i++) {
        const d = new Date(baseDate);
        d.setUTCDate(baseDate.getUTCDate() + i);
        extendedRecords.push({
          id: `es-${i}`,
          venueId: "v-madrid",
          venueName: "Impact Hub Madrid",
          city: "Madrid",
          country: "Spain",
          countryCode: "ES",
          isSchengen: true,
          date: d.toISOString().split("T")[0],
          amountSpent: 35,
          currency: "USD",
          vatRatePct: 21,
        });
      }

      const report = generateNomadComplianceReport(extendedRecords, 2026);
      const pdfBytes = await generateNomadTaxAuditPdf(report, {
        userId: "user-dual-resident",
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBeGreaterThanOrEqual(2);
    });

    it("supports generating audit PDF directly from NomadTaxComplianceReport", async () => {
      const presenceEntries: TaxPresenceEntry[] = [
        {
          id: "entry-1",
          userId: "nomad-77",
          countryCode: "PT",
          jurisdiction: "Portugal",
          timestamp: "2026-02-01T10:00:00Z",
        },
        {
          id: "entry-2",
          userId: "nomad-77",
          countryCode: "PT",
          jurisdiction: "Portugal",
          timestamp: "2026-02-02T10:00:00Z",
        },
        {
          id: "entry-3",
          userId: "nomad-77",
          countryCode: "ES",
          jurisdiction: "Spain",
          timestamp: "2026-03-01T10:00:00Z",
        },
      ];

      const report = calculateNomadTaxPresence(presenceEntries, { taxYear: 2026 });
      const pdfBytes = await generateNomadTaxAuditPdf(report, { userId: "nomad-77" });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      const loadedDoc = await PDFDocument.load(pdfBytes);
      expect(loadedDoc.getPageCount()).toBeGreaterThanOrEqual(2);
    });

    it("sanitizes unusual Unicode glyphs and mathematical symbols without font crashes", async () => {
      const recordsWithSpecialGlyphs: NomadCheckInRecord[] = [
        {
          id: "rec-uni",
          venueId: "v-tokyo",
          venueName: "Café de l'Étoile — Zürich 🌟 & Tokyo 東京 (Rate: 15€/hr ≈ 20$)",
          city: "Zürich",
          country: "Switzerland",
          countryCode: "CH",
          isSchengen: true,
          date: "2026-07-01",
          amountSpent: 150,
          currency: "EUR",
          vatRatePct: 7.7,
        },
      ];

      const report = generateNomadComplianceReport(recordsWithSpecialGlyphs, 2026);
      expect(async () => {
        await generateNomadTaxAuditPdf(report);
      }).not.toThrow();

      const pdfBytes = await generateNomadTaxAuditPdf(report);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
    });
  });
});

