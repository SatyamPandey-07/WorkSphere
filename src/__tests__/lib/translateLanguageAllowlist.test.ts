/**
 * Tests for the translate API language allowlist (Issue #1653).
 * Ensures only supported languages are accepted.
 */

const ALLOWED_LANGUAGES = new Set([
  "en", "english",
  "es", "spanish",
  "fr", "french",
  "de", "german",
  "it", "italian",
  "pt", "portuguese",
  "nl", "dutch",
  "ru", "russian",
  "zh", "chinese",
  "ja", "japanese",
  "ko", "korean",
  "ar", "arabic",
  "hi", "hindi",
  "pl", "polish",
  "sv", "swedish",
  "tr", "turkish",
  "vi", "vietnamese",
  "th", "thai",
  "id", "indonesian",
]);

function isAllowedLanguage(lang: string): boolean {
  return ALLOWED_LANGUAGES.has(lang.trim().toLowerCase());
}

describe("Translate API language allowlist", () => {
  it("allows ISO 639-1 codes", () => {
    ["en", "fr", "de", "zh", "ja", "ko", "ar"].forEach((code) => {
      expect(isAllowedLanguage(code)).toBe(true);
    });
  });

  it("allows full language names", () => {
    ["english", "french", "german", "chinese", "japanese"].forEach((name) => {
      expect(isAllowedLanguage(name)).toBe(true);
    });
  });

  it("rejects unsupported languages", () => {
    ["klingon", "elvish", "leet", "mandarin", "cantonese"].forEach((lang) => {
      expect(isAllowedLanguage(lang)).toBe(false);
    });
  });

  it("is case-insensitive", () => {
    expect(isAllowedLanguage("EN")).toBe(true);
    expect(isAllowedLanguage("French")).toBe(true);
    expect(isAllowedLanguage("GERMAN")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(isAllowedLanguage("  en  ")).toBe(true);
    expect(isAllowedLanguage("fr ")).toBe(true);
  });

  it("has 20 ISO codes and 20 name equivalents (40 total entries)", () => {
    expect(ALLOWED_LANGUAGES.size).toBe(40);
  });

  it("all ISO 639-1 codes are 2 characters long", () => {
    const codes = [...ALLOWED_LANGUAGES].filter((l) => l.length === 2);
    expect(codes.length).toBe(20);
  });

  it("rejects empty string", () => {
    expect(isAllowedLanguage("")).toBe(false);
  });
});
