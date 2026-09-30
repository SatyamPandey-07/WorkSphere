/**
 * Tests for user language preference and locale resolution.
 */

const SUPPORTED_LOCALES = ["en", "es", "fr", "de", "ja", "zh"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

function resolveLocale(
  preferred: string | undefined,
  browserLocales: string[],
  fallback: SupportedLocale = "en"
): SupportedLocale {
  if (preferred && isSupportedLocale(preferred)) return preferred;
  for (const bl of browserLocales) {
    const lang = bl.split("-")[0].toLowerCase();
    if (isSupportedLocale(lang)) return lang as SupportedLocale;
  }
  return fallback;
}

function formatLocaleLabel(locale: SupportedLocale): string {
  const labels: Record<SupportedLocale, string> = {
    en: "English", es: "Español", fr: "Français",
    de: "Deutsch", ja: "日本語", zh: "中文",
  };
  return labels[locale];
}

describe("User language preference", () => {
  it("isSupportedLocale: en → true", () => {
    expect(isSupportedLocale("en")).toBe(true);
  });

  it("isSupportedLocale: ja → true", () => {
    expect(isSupportedLocale("ja")).toBe(true);
  });

  it("isSupportedLocale: pt → false", () => {
    expect(isSupportedLocale("pt")).toBe(false);
  });

  it("resolveLocale: explicit supported preference", () => {
    expect(resolveLocale("fr", [])).toBe("fr");
  });

  it("resolveLocale: unsupported pref falls to browser", () => {
    expect(resolveLocale("pt", ["de-DE"])).toBe("de");
  });

  it("resolveLocale: browser locale with region code", () => {
    expect(resolveLocale(undefined, ["zh-TW"])).toBe("zh");
  });

  it("resolveLocale: no match → fallback en", () => {
    expect(resolveLocale(undefined, ["pt-BR"])).toBe("en");
  });

  it("resolveLocale: empty browser locales → fallback", () => {
    expect(resolveLocale(undefined, [])).toBe("en");
  });

  it("formatLocaleLabel: en → English", () => {
    expect(formatLocaleLabel("en")).toBe("English");
  });

  it("formatLocaleLabel: ja → 日本語", () => {
    expect(formatLocaleLabel("ja")).toBe("日本語");
  });
});
