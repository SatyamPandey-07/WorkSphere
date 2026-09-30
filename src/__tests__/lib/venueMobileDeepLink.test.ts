/**
 * Tests for mobile app deep link routing for venue discovery.
 */

type DeepLinkScreen =
  | "home"
  | "search"
  | "venue_detail"
  | "booking_flow"
  | "booking_confirmation"
  | "profile"
  | "notifications";

interface DeepLinkRoute {
  screen: DeepLinkScreen;
  params?: Record<string, string>;
}

function parseAppDeepLink(url: string): DeepLinkRoute | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "worksphere:") return null;

    const screen = u.hostname as DeepLinkScreen;
    const params: Record<string, string> = {};
    u.searchParams.forEach((val, key) => { params[key] = val; });

    return { screen, params: Object.keys(params).length > 0 ? params : undefined };
  } catch {
    return null;
  }
}

function buildAppDeepLink(route: DeepLinkRoute): string {
  const url = new URL(`worksphere://${route.screen}`);
  if (route.params) {
    Object.entries(route.params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return url.toString();
}

function isValidDeepLinkScreen(screen: string): screen is DeepLinkScreen {
  const valid: DeepLinkScreen[] = [
    "home", "search", "venue_detail", "booking_flow",
    "booking_confirmation", "profile", "notifications",
  ];
  return (valid as string[]).includes(screen);
}

describe("Venue mobile app deep links", () => {
  it("parseAppDeepLink: venue detail with ID", () => {
    const result = parseAppDeepLink("worksphere://venue_detail?venueId=v123");
    expect(result!.screen).toBe("venue_detail");
    expect(result!.params!.venueId).toBe("v123");
  });

  it("parseAppDeepLink: no params", () => {
    const result = parseAppDeepLink("worksphere://home");
    expect(result!.screen).toBe("home");
    expect(result!.params).toBeUndefined();
  });

  it("parseAppDeepLink: wrong protocol → null", () => {
    expect(parseAppDeepLink("https://worksphere.com/home")).toBeNull();
  });

  it("parseAppDeepLink: invalid URL → null", () => {
    expect(parseAppDeepLink("not-a-url")).toBeNull();
  });

  it("buildAppDeepLink: home screen", () => {
    expect(buildAppDeepLink({ screen: "home" })).toContain("worksphere://home");
  });

  it("buildAppDeepLink: with params", () => {
    const link = buildAppDeepLink({ screen: "booking_flow", params: { venueId: "v1", date: "2026-10-01" } });
    expect(link).toContain("venueId=v1");
    expect(link).toContain("date=2026-10-01");
  });

  it("round-trip: build then parse", () => {
    const route: DeepLinkRoute = { screen: "booking_confirmation", params: { bookingId: "b99" } };
    const parsed = parseAppDeepLink(buildAppDeepLink(route));
    expect(parsed!.screen).toBe("booking_confirmation");
    expect(parsed!.params!.bookingId).toBe("b99");
  });

  it("isValidDeepLinkScreen: valid screens", () => {
    expect(isValidDeepLinkScreen("search")).toBe(true);
    expect(isValidDeepLinkScreen("notifications")).toBe(true);
  });

  it("isValidDeepLinkScreen: unknown screen → false", () => {
    expect(isValidDeepLinkScreen("unknown_screen")).toBe(false);
  });
});
