import { z } from "zod";

export const VENUE_FILTERS = {
  wifi: { type: "boolean" as const, default: false },
  outlets: { type: "boolean" as const, default: false },
  quiet: { type: "boolean" as const, default: false },
  ergonomic: { type: "boolean" as const, default: false },
  outletDensity: {
    type: "enum" as const,
    values: ["every_table", "some_tables", "wall_seats", "none"] as const,
    default: "none",
  },
  wifiSpeedBand: {
    type: "enum" as const,
    values: ["basic", "fast", "ultra", "all"] as const,
    default: "all",
  },
  hasPhoneBooths: { type: "boolean" as const, default: false },
  hasNoMusic: { type: "boolean" as const, default: false },
  hasQuietZone: { type: "boolean" as const, default: false },
  hasAncHeadsetRental: { type: "boolean" as const, default: false },
  singleOriginBeans: { type: "boolean" as const, default: false },
  specialtyEspresso: { type: "boolean" as const, default: false },
  oatAlmondMilk: { type: "boolean" as const, default: false },
  pourOverAvailable: { type: "boolean" as const, default: false },
  lighting: {
    type: "enum" as const,
    values: [
      "natural_daylight",
      "warm_ambient",
      "fluorescent",
      "bright_white",
    ] as const,
    default: undefined,
  },
  petsAllowedIndoors: { type: "boolean" as const, default: false },
  patioOnly: { type: "boolean" as const, default: false },
  waterBowlsProvided: { type: "boolean" as const, default: false },
  dogFriendly: { type: "boolean" as const, default: false },
  catsAllowed: { type: "boolean" as const, default: false },
  musicStyle: {
    type: "enum" as const,
    values: ["lofi", "classical_jazz", "no_music", "all"] as const,
    default: "all",
  },
} as const satisfies Record<
  string,
  { type: "boolean" | "enum"; values?: readonly string[]; default: unknown }
>;

export type VenueFilterKey = keyof typeof VENUE_FILTERS;
export type VenueFilters = Partial<Record<VenueFilterKey, unknown>>;

interface VenueLike {
  wifi?: boolean;
  hasOutlets?: boolean;
  noiseLevel?: string;
  hasErgonomic?: boolean;
  outletDensity?: string;
  wifiSpeed?: number | null;
  hasPhoneBooths?: boolean;
  hasNoMusic?: boolean;
  hasQuietZone?: boolean;
  hasAncHeadsetRental?: boolean;
  singleOriginBeans?: boolean;
  specialtyEspresso?: boolean;
  oatAlmondMilk?: boolean;
  pourOverAvailable?: boolean;
  musicStyle?: string;
  [key: string]: unknown;
}

function matchesOutletDensity(venue: VenueLike, target: string): boolean {
  if (target === "every_table") return venue.outletDensity === "every_table";
  if (target === "some_tables")
    return ["every_table", "some_tables"].includes(venue.outletDensity ?? "");
  if (target === "wall_seats")
    return ["every_table", "some_tables", "wall_seats"].includes(
      venue.outletDensity ?? "",
    );
  return true;
}

function matchesWifiSpeedBand(venue: VenueLike, band: string): boolean {
  const speed = venue.wifiSpeed;
  if (speed === null || speed === undefined) return false;
  if (band === "basic") return speed >= 10;
  if (band === "fast") return speed >= 50;
  if (band === "ultra") return speed >= 100;
  return true;
}

function matchesMusicStyle(venue: VenueLike, style: string): boolean {
  if (style === "no_music")
    return venue.musicStyle === "no_music" || venue.hasNoMusic === true;
  return venue.musicStyle === style;
}

export function applyFilters<T extends VenueLike>(
  venues: T[],
  filters: VenueFilters,
): T[] {
  const active = Object.entries(filters).filter(
    ([key, value]) =>
      value !== undefined &&
      value !== null &&
      value !== VENUE_FILTERS[key as VenueFilterKey]?.default,
  );
  if (active.length === 0) return venues;

  return venues.filter((venue) =>
    active.every(([key, value]) => {
      switch (key) {
        case "wifi":
          return venue.wifi === true;
        case "outlets":
          return venue.hasOutlets === true;
        case "quiet":
          return venue.noiseLevel === "quiet";
        case "ergonomic":
          return venue.hasErgonomic === true;
        case "outletDensity":
          return matchesOutletDensity(venue, value as string);
        case "wifiSpeedBand":
          return matchesWifiSpeedBand(venue, value as string);
        case "hasPhoneBooths":
          return venue.hasPhoneBooths === true;
        case "hasAncHeadsetRental":
          return venue.hasAncHeadsetRental === true;
        case "singleOriginBeans":
          return venue.singleOriginBeans === true;
        case "specialtyEspresso":
          return venue.specialtyEspresso === true;
        case "oatAlmondMilk":
          return venue.oatAlmondMilk === true;
        case "pourOverAvailable":
          return venue.pourOverAvailable === true;
        case "hasNoMusic":
          return venue.hasNoMusic === true;
        case "hasQuietZone":
          return venue.hasQuietZone === true;
        case "musicStyle":
          return matchesMusicStyle(venue, value as string);
        default:
          return true;
      }
    }),
  );
}

export function buildVenueSearchSchema() {
  const shape: Record<string, z.ZodTypeAny> = {
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radius: z.coerce.number().min(100).max(50000).default(5000),
    category: z.enum(["cafe", "coworking", "library", "all"]).optional(),
    cities: z.string().optional(),
  };

  for (const [key, config] of Object.entries(VENUE_FILTERS)) {
    if (config.type === "boolean") {
      shape[key] = z.coerce.boolean().optional();
    } else if (config.type === "enum" && config.values) {
      shape[key] = z
        .enum(config.values as unknown as [string, ...string[]])
        .optional();
    }
  }

  return z.object(shape);
}

export type VenueSearchFilters = z.infer<
  ReturnType<typeof buildVenueSearchSchema>
>;
