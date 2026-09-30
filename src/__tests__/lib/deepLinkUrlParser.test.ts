/**
 * Tests for deep link URL parsing for venue/booking navigation.
 */

interface DeepLinkParams {
  screen: string;
  venueId?: string;
  bookingId?: string;
  date?: string;
  tab?: string;
}

function parseDeepLink(url: string): DeepLinkParams | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "worksphere:") return null;
    const screen = parsed.hostname;
    const params: DeepLinkParams = { screen };
    parsed.searchParams.forEach((value, key) => {
      (params as Record<string, string>)[key] = value;
    });
    return params;
  } catch {
    return null;
  }
}

function buildDeepLink(params: DeepLinkParams): string {
  const url = new URL(`worksphere://${params.screen}`);
  Object.entries(params)
    .filter(([k]) => k !== "screen")
    .forEach(([k, v]) => { if (v) url.searchParams.set(k, String(v)); });
  return url.toString();
}

describe("Deep link URL parser", () => {
  it("parseDeepLink: valid venue link", () => {
    const result = parseDeepLink("worksphere://venue?venueId=v123");
    expect(result).not.toBeNull();
    expect(result!.screen).toBe("venue");
    expect(result!.venueId).toBe("v123");
  });

  it("parseDeepLink: booking link with bookingId", () => {
    const result = parseDeepLink("worksphere://booking?bookingId=b456");
    expect(result!.bookingId).toBe("b456");
  });

  it("parseDeepLink: wrong protocol → null", () => {
    expect(parseDeepLink("https://worksphere.com/venue")).toBeNull();
  });

  it("parseDeepLink: invalid URL → null", () => {
    expect(parseDeepLink("not-a-url")).toBeNull();
  });

  it("buildDeepLink: creates correct URL", () => {
    const url = buildDeepLink({ screen: "venue", venueId: "v123" });
    expect(url).toContain("worksphere://venue");
    expect(url).toContain("venueId=v123");
  });

  it("buildDeepLink: omits undefined params", () => {
    const url = buildDeepLink({ screen: "home" });
    expect(url).toBe("worksphere://home/");
  });

  it("round-trip: build then parse", () => {
    const params: DeepLinkParams = { screen: "booking", bookingId: "b789", date: "2026-10-01" };
    const url = buildDeepLink(params);
    const parsed = parseDeepLink(url);
    expect(parsed!.screen).toBe("booking");
    expect(parsed!.bookingId).toBe("b789");
  });
});
