/**
 * Tests for venue outdoor/rooftop area availability based on weather.
 */

type WeatherCondition = "sunny" | "cloudy" | "rainy" | "stormy" | "snowy";

interface OutdoorSpace {
  spaceId: string;
  venueId: string;
  name: string;
  capacitySeated: number;
  hasShade: boolean;
  hasHeating: boolean;
  isWeatherDependent: boolean;
}

function isOutdoorAvailable(
  space: OutdoorSpace,
  weather: WeatherCondition
): boolean {
  if (!space.isWeatherDependent) return true;
  if (weather === "stormy" || weather === "snowy") return false;
  if (weather === "rainy" && !space.hasShade) return false;
  return true;
}

function weatherComfort(
  space: OutdoorSpace,
  weather: WeatherCondition,
  tempCelsius: number
): "comfortable" | "okay" | "uncomfortable" {
  if (weather === "stormy" || weather === "snowy") return "uncomfortable";
  if (weather === "rainy" && !space.hasShade) return "uncomfortable";
  if (tempCelsius < 5 && !space.hasHeating) return "uncomfortable";
  if (tempCelsius < 10) return "okay";
  if (weather === "sunny" && tempCelsius >= 18 && tempCelsius <= 28) return "comfortable";
  return "okay";
}

function availableOutdoorSpaces(
  spaces: OutdoorSpace[],
  venueId: string,
  weather: WeatherCondition
): OutdoorSpace[] {
  return spaces.filter(
    (s) => s.venueId === venueId && isOutdoorAvailable(s, weather)
  );
}

const SPACES: OutdoorSpace[] = [
  { spaceId: "o1", venueId: "v1", name: "Rooftop",    capacitySeated: 20, hasShade: false, hasHeating: false, isWeatherDependent: true  },
  { spaceId: "o2", venueId: "v1", name: "Patio",      capacitySeated: 30, hasShade: true,  hasHeating: true,  isWeatherDependent: true  },
  { spaceId: "o3", venueId: "v1", name: "Greenhouse", capacitySeated: 15, hasShade: true,  hasHeating: true,  isWeatherDependent: false },
];

describe("Venue outdoor area availability", () => {
  it("isOutdoorAvailable: sunny → all available", () => {
    expect(SPACES.every((s) => isOutdoorAvailable(s, "sunny"))).toBe(true);
  });

  it("isOutdoorAvailable: stormy → dependent spaces unavailable", () => {
    expect(isOutdoorAvailable(SPACES[0], "stormy")).toBe(false);
  });

  it("isOutdoorAvailable: stormy → non-dependent always available", () => {
    expect(isOutdoorAvailable(SPACES[2], "stormy")).toBe(true);
  });

  it("isOutdoorAvailable: rainy with shade → available", () => {
    expect(isOutdoorAvailable(SPACES[1], "rainy")).toBe(true);
  });

  it("isOutdoorAvailable: rainy without shade → unavailable", () => {
    expect(isOutdoorAvailable(SPACES[0], "rainy")).toBe(false);
  });

  it("weatherComfort: sunny 22°C → comfortable", () => {
    expect(weatherComfort(SPACES[1], "sunny", 22)).toBe("comfortable");
  });

  it("weatherComfort: cold with no heating → uncomfortable", () => {
    expect(weatherComfort(SPACES[0], "cloudy", 2)).toBe("uncomfortable");
  });

  it("availableOutdoorSpaces: rainy = patio + greenhouse", () => {
    const available = availableOutdoorSpaces(SPACES, "v1", "rainy");
    expect(available).toHaveLength(2);
  });
});
