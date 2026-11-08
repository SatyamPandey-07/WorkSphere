import {
  sanitizeDisplayName,
  validateDisplayName,
  sanitizeCallsign,
  validateCallsign,
  formatDisplayNameWithCallsign,
} from "../../lib/profileSanitizer";

describe("profileSanitizer - Custom Display Name Whitespace Sanitization (#4370)", () => {
  describe("sanitizeDisplayName", () => {
    test("returns empty string for null, undefined, or empty string", () => {
      expect(sanitizeDisplayName(null)).toBe("");
      expect(sanitizeDisplayName(undefined)).toBe("");
      expect(sanitizeDisplayName("")).toBe("");
    });

    test("trims leading whitespace", () => {
      expect(sanitizeDisplayName("   John Doe")).toBe("John Doe");
      expect(sanitizeDisplayName("\t\tAlice Smith")).toBe("Alice Smith");
      expect(sanitizeDisplayName("\n\nBob")).toBe("Bob");
    });

    test("trims trailing whitespace", () => {
      expect(sanitizeDisplayName("John Doe   ")).toBe("John Doe");
      expect(sanitizeDisplayName("Alice Smith\t\t")).toBe("Alice Smith");
      expect(sanitizeDisplayName("Bob\n\n")).toBe("Bob");
    });

    test("trims both leading and trailing whitespace", () => {
      expect(sanitizeDisplayName("   Satyam Pandey   ")).toBe("Satyam Pandey");
      expect(sanitizeDisplayName(" \t  Jane Doe \n ")).toBe("Jane Doe");
    });

    test("collapses multiple consecutive internal spaces into a single space", () => {
      expect(sanitizeDisplayName("John    Middle    Doe")).toBe("John Middle Doe");
      expect(sanitizeDisplayName("Satyam    Pandey")).toBe("Satyam Pandey");
      expect(sanitizeDisplayName("First   Second   Third   Fourth")).toBe("First Second Third Fourth");
    });

    test("handles combination of leading, trailing, internal spaces and tabs", () => {
      expect(sanitizeDisplayName("  \t  Jane   \t  Doe  \n  ")).toBe("Jane Doe");
    });
  });

  describe("validateDisplayName - Client-side validation feedback", () => {
    test("returns error when display name is empty or only whitespace", () => {
      const res1 = validateDisplayName("");
      expect(res1.isValid).toBe(false);
      expect(res1.error).toBe("Display name cannot be empty or contain only whitespace.");

      const res2 = validateDisplayName("     ");
      expect(res2.isValid).toBe(false);
      expect(res2.error).toBe("Display name cannot be empty or contain only whitespace.");

      const res3 = validateDisplayName("\t\n ");
      expect(res3.isValid).toBe(false);
      expect(res3.error).toBe("Display name cannot be empty or contain only whitespace.");
    });

    test("returns error when display name is under minimum length limit", () => {
      const res = validateDisplayName("   A   ");
      expect(res.isValid).toBe(false);
      expect(res.sanitized).toBe("A");
      expect(res.error).toBe("Display name must be at least 2 characters long.");
    });

    test("returns error when display name exceeds maximum length limit", () => {
      const longName = "A".repeat(55);
      expect(validateDisplayName(longName).isValid).toBe(false);
      expect(validateDisplayName(longName).error).toBe("Display name cannot exceed 50 characters.");
    });

    test("returns valid result with sanitized string for valid input", () => {
      const res = validateDisplayName("   Satyam    Pandey   ");
      expect(res.isValid).toBe(true);
      expect(res.sanitized).toBe("Satyam Pandey");
      expect(res.error).toBeUndefined();
    });
  });

  describe("Test Pilot Flight Callsign (#6172)", () => {
    describe("sanitizeCallsign", () => {
      test("returns empty string for null, undefined, or empty string", () => {
        expect(sanitizeCallsign(null)).toBe("");
        expect(sanitizeCallsign(undefined)).toBe("");
        expect(sanitizeCallsign("")).toBe("");
      });

      test("trims leading and trailing whitespace", () => {
        expect(sanitizeCallsign("   Highball   ")).toBe("Highball");
        expect(sanitizeCallsign("\tMaverick\n")).toBe("Maverick");
      });

      test("collapses multiple internal spaces if present", () => {
        expect(sanitizeCallsign("Top   Gun")).toBe("Top Gun");
      });
    });

    describe("validateCallsign - Alphanumeric & hyphens validation", () => {
      test("accepts empty or null callsign as optional valid input", () => {
        expect(validateCallsign("").isValid).toBe(true);
        expect(validateCallsign("").sanitized).toBe("");
        expect(validateCallsign(null).isValid).toBe(true);
        expect(validateCallsign(undefined).isValid).toBe(true);
      });

      test("accepts valid alphanumeric callsigns and hyphens", () => {
        expect(validateCallsign("Highball").isValid).toBe(true);
        expect(validateCallsign("Maverick").isValid).toBe(true);
        expect(validateCallsign("Emerald").isValid).toBe(true);
        expect(validateCallsign("RAPTOR-01").isValid).toBe(true);
        expect(validateCallsign("top-gun").isValid).toBe(true);
        expect(validateCallsign("Lantern-2814").isValid).toBe(true);
      });

      test("rejects callsigns exceeding 20 characters", () => {
        const longCallsign = "A".repeat(21);
        const res = validateCallsign(longCallsign);
        expect(res.isValid).toBe(false);
        expect(res.error).toBe("Callsign cannot exceed 20 characters.");
      });

      test("rejects special characters, spaces, and punctuation", () => {
        const res1 = validateCallsign("High ball");
        expect(res1.isValid).toBe(false);
        expect(res1.error).toBe("Callsign can only contain alphanumeric characters and hyphens.");

        const res2 = validateCallsign("Maverick!");
        expect(res2.isValid).toBe(false);
        expect(res2.error).toBe("Callsign can only contain alphanumeric characters and hyphens.");

        const res3 = validateCallsign("pilot_01");
        expect(res3.isValid).toBe(false);
        expect(res3.error).toBe("Callsign can only contain alphanumeric characters and hyphens.");

        const res4 = validateCallsign("Ghost@");
        expect(res4.isValid).toBe(false);
        expect(res4.error).toBe("Callsign can only contain alphanumeric characters and hyphens.");
      });
    });

    describe("formatDisplayNameWithCallsign - Preview formatting", () => {
      test("formats name with callsign in quotes between first and last name", () => {
        expect(formatDisplayNameWithCallsign("Hal Jordan", "Highball")).toBe('Hal "Highball" Jordan');
        expect(formatDisplayNameWithCallsign("Pete Mitchell", "Maverick")).toBe('Pete "Maverick" Mitchell');
        expect(formatDisplayNameWithCallsign("John Stewart", "Emerald")).toBe('John "Emerald" Stewart');
      });

      test("formats single word display name with callsign appended in quotes", () => {
        expect(formatDisplayNameWithCallsign("Hal", "Highball")).toBe('Hal "Highball"');
      });

      test("formats multiple middle names correctly placing callsign after first name", () => {
        expect(formatDisplayNameWithCallsign("Hal Bob Jordan", "Highball")).toBe('Hal "Highball" Bob Jordan');
      });

      test("returns plain display name when callsign is empty or whitespace", () => {
        expect(formatDisplayNameWithCallsign("Hal Jordan", "")).toBe("Hal Jordan");
        expect(formatDisplayNameWithCallsign("Hal Jordan", "   ")).toBe("Hal Jordan");
        expect(formatDisplayNameWithCallsign("Hal Jordan", null)).toBe("Hal Jordan");
        expect(formatDisplayNameWithCallsign("Hal Jordan", undefined)).toBe("Hal Jordan");
      });

      test("returns quoted callsign when display name is empty", () => {
        expect(formatDisplayNameWithCallsign("", "Highball")).toBe('"Highball"');
        expect(formatDisplayNameWithCallsign(null, "Highball")).toBe('"Highball"');
      });

      test("returns empty string when both display name and callsign are empty", () => {
        expect(formatDisplayNameWithCallsign("", "")).toBe("");
      });
    });
  });
});

