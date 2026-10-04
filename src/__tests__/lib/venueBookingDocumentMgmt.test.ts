/**
 * Tests for venue booking document management and e-signature workflow.
 */

type DocumentType = "booking_agreement" | "terms_conditions" | "insurance_cert" | "health_safety" | "invoice" | "receipt";
type DocumentStatus = "draft" | "pending_signature" | "signed" | "expired" | "voided";

interface Document {
  id: string;
  bookingId: string;
  type: DocumentType;
  status: DocumentStatus;
  createdAt: number;
  expiresAt: number | null;
  signedAt: number | null;
  signedBy: string | null;
  version: number;
}

function isDocumentValid(doc: Document, nowMs: number): boolean {
  if (doc.status === "voided" || doc.status === "expired") return false;
  if (doc.expiresAt !== null && nowMs > doc.expiresAt) return false;
  return true;
}

function pendingSignatures(docs: Document[]): Document[] {
  return docs.filter((d) => d.status === "pending_signature");
}

function signatureAge(doc: Document, nowMs: number): number | null {
  if (!doc.signedAt) return null;
  return Math.floor((nowMs - doc.signedAt) / 86_400_000);
}

function documentsForBooking(docs: Document[], bookingId: string): Document[] {
  return docs.filter((d) => d.bookingId === bookingId);
}

function isBookingDocumentComplete(docs: Document[], bookingId: string): boolean {
  const required: DocumentType[] = ["booking_agreement", "terms_conditions"];
  const bookingDocs = documentsForBooking(docs, bookingId);
  return required.every((type) =>
    bookingDocs.some((d) => d.type === type && d.status === "signed")
  );
}

function latestVersion(docs: Document[], type: DocumentType, bookingId: string): Document | null {
  const matching = docs.filter((d) => d.bookingId === bookingId && d.type === type);
  if (matching.length === 0) return null;
  return matching.reduce((latest, d) => d.version > latest.version ? d : latest, matching[0]);
}

const NOW = 1_700_000_000_000;
const DOCS: Document[] = [
  { id: "d1", bookingId: "b1", type: "booking_agreement",  status: "signed",            createdAt: NOW - 5 * 86_400_000, expiresAt: null,               signedAt: NOW - 4 * 86_400_000, signedBy: "u1", version: 1 },
  { id: "d2", bookingId: "b1", type: "terms_conditions",   status: "pending_signature", createdAt: NOW - 3 * 86_400_000, expiresAt: NOW + 7 * 86_400_000,signedAt: null,                  signedBy: null, version: 1 },
  { id: "d3", bookingId: "b1", type: "invoice",            status: "draft",             createdAt: NOW - 86_400_000,     expiresAt: null,                signedAt: null,                  signedBy: null, version: 1 },
];

describe("Document management and e-signatures", () => {
  it("isDocumentValid: signed agreement → valid", () => {
    expect(isDocumentValid(DOCS[0], NOW)).toBe(true);
  });

  it("isDocumentValid: voided document → invalid", () => {
    expect(isDocumentValid({ ...DOCS[0], status: "voided" }, NOW)).toBe(false);
  });

  it("pendingSignatures: 1 pending signature", () => {
    expect(pendingSignatures(DOCS).length).toBe(1);
  });

  it("isBookingDocumentComplete: terms still pending → false", () => {
    expect(isBookingDocumentComplete(DOCS, "b1")).toBe(false);
  });

  it("signatureAge: d1 signed 4 days ago", () => {
    expect(signatureAge(DOCS[0], NOW)).toBe(4);
  });

  it("latestVersion: returns version 1 agreement", () => {
    expect(latestVersion(DOCS, "booking_agreement", "b1")?.version).toBe(1);
  });
});
