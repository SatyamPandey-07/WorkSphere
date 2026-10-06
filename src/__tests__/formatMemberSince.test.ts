import { formatMemberSince } from "@/lib/formatMemberSince";

// Mid-month, midday UTC: the same month in every timezone.
const OCT_2025 = "2025-10-15T12:00:00Z";

describe("formatMemberSince", () => {
  it("formats a Date as 'Member since <Month> <Year>'", () => {
    expect(formatMemberSince(new Date(OCT_2025))).toBe(
      "Member since October 2025",
    );
  });

  it("formats an ISO string", () => {
    expect(formatMemberSince(OCT_2025)).toBe("Member since October 2025");
  });

  it("formats a millisecond timestamp", () => {
    expect(formatMemberSince(Date.UTC(2025, 9, 15, 12))).toBe(
      "Member since October 2025",
    );
  });

  it("uses the full month name", () => {
    expect(formatMemberSince("2024-03-15T12:00:00Z")).toBe(
      "Member since March 2024",
    );
  });

  it("returns null for missing values", () => {
    expect(formatMemberSince(null)).toBeNull();
    expect(formatMemberSince(undefined)).toBeNull();
    expect(formatMemberSince("")).toBeNull();
  });

  it("returns null for invalid dates", () => {
    expect(formatMemberSince("not-a-date")).toBeNull();
    expect(formatMemberSince(new Date("invalid"))).toBeNull();
    expect(formatMemberSince(Number.NaN)).toBeNull();
  });
});
