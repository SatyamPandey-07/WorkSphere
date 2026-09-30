/**
 * Tests for multi-language venue name handling.
 */

interface LocalizedName {
  locale: string;
  name: string;
}

function getVenueName(
  names: LocalizedName[],
  preferredLocale: string,
  fallbackLocale = "en"
): string | null {
  const preferred = names.find((n) => n.locale === preferredLocale);
  if (preferred) return preferred.name;
  const fallback = names.find((n) => n.locale === fallbackLocale);
  return fallback ? fallback.name : null;
}

function hasLocalization(names: LocalizedName[], locale: string): boolean {
  return names.some((n) => n.locale === locale);
}

function availableLocales(names: LocalizedName[]): string[] {
  return [...new Set(names.map((n) => n.locale))];
}

function addLocalization(
  names: LocalizedName[],
  locale: string,
  name: string
): LocalizedName[] {
  const existing = names.findIndex((n) => n.locale === locale);
  if (existing !== -1) {
    return names.map((n, i) => (i === existing ? { locale, name } : n));
  }
  return [...names, { locale, name }];
}

const NAMES: LocalizedName[] = [
  { locale: "en", name: "The Coffee Hub"    },
  { locale: "fr", name: "Le Hub de Café"   },
  { locale: "de", name: "Der Kaffee-Hub"   },
];

describe("Multi-language venue names", () => {
  it("getVenueName: preferred locale found", () => {
    expect(getVenueName(NAMES, "fr")).toBe("Le Hub de Café");
  });

  it("getVenueName: fallback to en when locale missing", () => {
    expect(getVenueName(NAMES, "ja")).toBe("The Coffee Hub");
  });

  it("getVenueName: null when no match or fallback", () => {
    expect(getVenueName(NAMES, "ja", "zh")).toBeNull();
  });

  it("hasLocalization: true for 'de'", () => {
    expect(hasLocalization(NAMES, "de")).toBe(true);
  });

  it("hasLocalization: false for 'es'", () => {
    expect(hasLocalization(NAMES, "es")).toBe(false);
  });

  it("availableLocales returns all 3", () => {
    const locales = availableLocales(NAMES);
    expect(locales).toHaveLength(3);
    expect(locales).toContain("en");
  });

  it("addLocalization: new locale added", () => {
    const updated = addLocalization(NAMES, "es", "El Hub de Café");
    expect(updated).toHaveLength(4);
    expect(updated.find((n) => n.locale === "es")!.name).toBe("El Hub de Café");
  });

  it("addLocalization: existing locale updated", () => {
    const updated = addLocalization(NAMES, "en", "Coffee Hub");
    expect(updated.find((n) => n.locale === "en")!.name).toBe("Coffee Hub");
    expect(updated).toHaveLength(3); // no duplicate
  });
});
