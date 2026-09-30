/**
 * Tests for venue document storage (contracts, licenses, permits).
 */

type DocumentType = "business_license" | "lease" | "insurance" | "health_cert" | "fire_cert";

interface VenueDocument {
  docId: string;
  venueId: string;
  type: DocumentType;
  fileName: string;
  uploadedAt: number;
  expiresAt: number | null;
  verified: boolean;
  sizeBytes: number;
}

function isDocumentExpired(doc: VenueDocument, nowMs: number): boolean {
  if (doc.expiresAt === null) return false;
  return nowMs >= doc.expiresAt;
}

function isDocumentValid(doc: VenueDocument, nowMs: number): boolean {
  return doc.verified && !isDocumentExpired(doc, nowMs);
}

function expiringDocuments(
  docs: VenueDocument[],
  venueId: string,
  nowMs: number,
  warningMs = 30 * 86_400_000
): VenueDocument[] {
  return docs.filter(
    (d) =>
      d.venueId === venueId &&
      d.expiresAt !== null &&
      !isDocumentExpired(d, nowMs) &&
      d.expiresAt - nowMs <= warningMs
  );
}

function totalStorageBytes(docs: VenueDocument[], venueId: string): number {
  return docs.filter((d) => d.venueId === venueId).reduce((sum, d) => sum + d.sizeBytes, 0);
}

function missingRequiredDocs(docs: VenueDocument[], venueId: string, nowMs: number): DocumentType[] {
  const required: DocumentType[] = ["business_license", "insurance"];
  return required.filter(
    (type) => !docs.some((d) => d.venueId === venueId && d.type === type && isDocumentValid(d, nowMs))
  );
}

const NOW = 1_700_000_000_000;
const DOCS: VenueDocument[] = [
  { docId: "d1", venueId: "v1", type: "business_license", fileName: "license.pdf", uploadedAt: NOW - 86_400_000, expiresAt: NOW + 15 * 86_400_000, verified: true,  sizeBytes: 200_000 }, // expiring soon
  { docId: "d2", venueId: "v1", type: "insurance",        fileName: "ins.pdf",    uploadedAt: NOW - 100_000,    expiresAt: NOW + 200 * 86_400_000, verified: true,  sizeBytes: 300_000 },
  { docId: "d3", venueId: "v1", type: "health_cert",      fileName: "health.pdf", uploadedAt: NOW - 200_000,    expiresAt: null,                  verified: false, sizeBytes: 100_000 },
];

describe("Venue document storage", () => {
  it("isDocumentExpired: null expiry → false", () => {
    expect(isDocumentExpired(DOCS[2], NOW)).toBe(false);
  });

  it("isDocumentExpired: past expiry → true", () => {
    const expired = { ...DOCS[0], expiresAt: NOW - 1 };
    expect(isDocumentExpired(expired, NOW)).toBe(true);
  });

  it("isDocumentValid: verified and not expired → true", () => {
    expect(isDocumentValid(DOCS[1], NOW)).toBe(true);
  });

  it("isDocumentValid: unverified → false", () => {
    expect(isDocumentValid(DOCS[2], NOW)).toBe(false);
  });

  it("expiringDocuments: d1 expires in 15 days (within 30-day warning)", () => {
    const expiring = expiringDocuments(DOCS, "v1", NOW);
    expect(expiring.map((d) => d.docId)).toContain("d1");
  });

  it("expiringDocuments: d2 expires in 200 days (not in warning)", () => {
    const expiring = expiringDocuments(DOCS, "v1", NOW);
    expect(expiring.map((d) => d.docId)).not.toContain("d2");
  });

  it("totalStorageBytes: v1 = 600000", () => {
    expect(totalStorageBytes(DOCS, "v1")).toBe(600_000);
  });

  it("missingRequiredDocs: all required present → empty", () => {
    expect(missingRequiredDocs(DOCS, "v1", NOW)).toHaveLength(0);
  });

  it("missingRequiredDocs: expired license missing", () => {
    const expiredLicense = [{ ...DOCS[0], expiresAt: NOW - 1 }, ...DOCS.slice(1)];
    expect(missingRequiredDocs(expiredLicense, "v1", NOW)).toContain("business_license");
  });
});
