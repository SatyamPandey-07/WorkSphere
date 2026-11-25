import { formatMemberSince } from "@/lib/formatMemberSince";

// Mid-month, midday UTC: the same month in every timezone.
const OCT_2025 = "2025-10-15T12:00:00Z";

describe("formatMemberSince", () => {
  describe("existing default behavior", () => {
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

    it("defaults prefix to 'Member since'", () => {
      const result = formatMemberSince(OCT_2025);
      expect(result).toMatch(/^Member since /);
    });

    it("defaults locale to 'en-US'", () => {
      expect(formatMemberSince(OCT_2025)).toBe(
        formatMemberSince(OCT_2025, "en-US"),
      );
    });
  });

  describe("date input handling", () => {
    it("formats a 10-digit second timestamp correctly", () => {
      const secondsTimestamp = Math.floor(new Date(OCT_2025).getTime() / 1000);
      expect(formatMemberSince(secondsTimestamp)).toBe(
        "Member since October 2025",
      );
    });

    it("returns null for non-positive or non-finite numbers", () => {
      expect(formatMemberSince(0)).toBeNull();
      expect(formatMemberSince(-1000)).toBeNull();
      expect(formatMemberSince(Infinity)).toBeNull();
      expect(formatMemberSince(-Infinity)).toBeNull();
      expect(formatMemberSince(Number.NaN)).toBeNull();
    });

    it("returns null for missing values", () => {
      expect(formatMemberSince(null)).toBeNull();
      expect(formatMemberSince(undefined)).toBeNull();
      expect(formatMemberSince("")).toBeNull();
    });

    it("returns null for invalid dates", () => {
      expect(formatMemberSince("not-a-date")).toBeNull();
      expect(formatMemberSince(new Date("invalid"))).toBeNull();
      expect(formatMemberSince("2025-99-99")).toBeNull();
    });
  });

  describe("valid locale formatting", () => {
    const testLocales = ["en-US", "es", "fr", "de", "hi", "ja"];

    testLocales.forEach((loc) => {
      it(`formats correctly for locale '${loc}'`, () => {
        const date = new Date(OCT_2025);
        const expectedDatePart = new Intl.DateTimeFormat(loc, {
          month: "long",
          year: "numeric",
        }).format(date);

        expect(formatMemberSince(date, loc)).toBe(
          `Member since ${expectedDatePart}`,
        );
      });
    });
  });

  describe("invalid locale fallback", () => {
    const invalidLocales = [
      "",
      "invalid-locale",
      "!",
      "123",
      "en_US",
      "a-b-c-d-e-f-g-h-i",
      "i-klingon-extra-long-invalid",
      "not@valid",
    ];

    invalidLocales.forEach((loc) => {
      it(`falls back to 'en-US' without throwing RangeError for locale '${loc}'`, () => {
        const expected = formatMemberSince(OCT_2025, "en-US");
        expect(() => formatMemberSince(OCT_2025, loc)).not.toThrow();
        expect(formatMemberSince(OCT_2025, loc)).toBe(expected);
      });
    });
  });

  describe("custom prefix support", () => {
    it("supports custom English prefix", () => {
      expect(formatMemberSince(OCT_2025, "en-US", "Joined")).toBe(
        "Joined October 2025",
      );
    });

    it("supports custom Spanish prefix with Spanish locale", () => {
      const date = new Date(OCT_2025);
      const expectedDatePart = new Intl.DateTimeFormat("es", {
        month: "long",
        year: "numeric",
      }).format(date);

      expect(formatMemberSince(date, "es", "Miembro desde")).toBe(
        `Miembro desde ${expectedDatePart}`,
      );
    });

    it("supports custom French prefix with French locale", () => {
      const date = new Date(OCT_2025);
      const expectedDatePart = new Intl.DateTimeFormat("fr", {
        month: "long",
        year: "numeric",
      }).format(date);

      expect(formatMemberSince(date, "fr", "Membre depuis")).toBe(
        `Membre depuis ${expectedDatePart}`,
      );
    });

    it("supports empty prefix", () => {
      expect(formatMemberSince(OCT_2025, "en-US", "")).toBe(" October 2025");
    });

    it("supports prefix containing whitespace", () => {
      expect(
        formatMemberSince(OCT_2025, "en-US", "  Active member since  "),
      ).toBe("  Active member since   October 2025");
    });

    it("supports prefix containing punctuation", () => {
      expect(formatMemberSince(OCT_2025, "en-US", "Member since:")).toBe(
        "Member since: October 2025",
      );
    });

    it("supports Unicode prefixes", () => {
      expect(formatMemberSince(OCT_2025, "en-US", "🚀 Member since")).toBe(
        "🚀 Member since October 2025",
      );
      expect(formatMemberSince(OCT_2025, "ja", "登録日:")).toBe(
        `登録日: ${new Intl.DateTimeFormat("ja", { month: "long", year: "numeric" }).format(new Date(OCT_2025))}`,
      );
    });

    it("combines custom prefix with invalid locale fallback", () => {
      expect(formatMemberSince(OCT_2025, "invalid!", "Joined")).toBe(
        "Joined October 2025",
      );
    });
  });

  describe("backward compatibility", () => {
    it("works when called with 1 argument (date only)", () => {
      expect(formatMemberSince(OCT_2025)).toBe("Member since October 2025");
    });

    it("works when called with 2 arguments (date and locale)", () => {
      const date = new Date(OCT_2025);
      const expectedFrench = new Intl.DateTimeFormat("fr", {
        month: "long",
        year: "numeric",
      }).format(date);

      expect(formatMemberSince(date, "fr")).toBe(
        `Member since ${expectedFrench}`,
      );
    });

    it("works when called with 3 arguments (date, locale, prefix)", () => {
      const date = new Date(OCT_2025);
      const expectedSpanish = new Intl.DateTimeFormat("es", {
        month: "long",
        year: "numeric",
      }).format(date);

      expect(formatMemberSince(date, "es", "Miembro desde")).toBe(
        `Miembro desde ${expectedSpanish}`,
      );
    });
  });
});
