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

/**
 * Sanitizes and clamps venue capacity filter inputs.
 * Capacity is clamped to integers >= 1; non-numeric, NaN, or negative inputs are defaulted to minimum 1.
 */
export function sanitizeCapacityInput(
  value: unknown,
  defaultValue: number = 1,
): number {
  if (value === undefined || value === null || value === "") {
    return Math.max(1, Math.floor(defaultValue) || 1);
  }
  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num) || !isFinite(num)) {
    return Math.max(1, Math.floor(defaultValue) || 1);
  }
  return Math.max(1, Math.floor(num));
}

export type VenueFilterKey = keyof typeof VENUE_FILTERS;
export type VenueFilters = Partial<Record<VenueFilterKey, unknown>> & {
  minCapacity?: number | string;
  category?: string;
};

interface VenueLike {
  category?: string;
  categories?: Array<{ name?: string } | string>;
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
  lighting?: string;
  petsAllowedIndoors?: boolean;
  patioOnly?: boolean;
  waterBowlsProvided?: boolean;
  dogFriendly?: boolean;
  catsAllowed?: boolean;
  musicStyle?: string;
  [key: string]: unknown;
}

function matchesOutletDensity(venue: VenueLike, target: string): boolean {
  if (!venue) return false;
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
  if (band === "all") return true;
  if (!venue) return false;
  const raw = venue.wifiSpeed;
  if (raw === null || raw === undefined || raw === "") return false;
  const speed = typeof raw === "number" ? raw : Number(raw);
  if (isNaN(speed) || !isFinite(speed)) return false;
  if (band === "basic") return speed >= 10;
  if (band === "fast") return speed >= 50;
  if (band === "ultra") return speed >= 100;
  return true;
}

function matchesMusicStyle(venue: VenueLike, style: string): boolean {
  if (style === "all") return true;
  if (!venue) return false;
  if (style === "no_music")
    return venue.musicStyle === "no_music" || venue.hasNoMusic === true;
  return venue.musicStyle === style;
}

export function applyFilters<T extends object>(
  venues: T[],
  filters: VenueFilters,
): T[] {
  if (!Array.isArray(venues)) return [];
  if (!filters || typeof filters !== "object") {
    return venues.filter((item): item is T => Boolean(item && typeof item === "object"));
  }

  const active = Object.entries(filters).filter(
    ([key, value]) =>
      value !== undefined &&
      value !== null &&
      value !== VENUE_FILTERS[key as VenueFilterKey]?.default,
  );
  if (active.length === 0) {
    return venues.filter((item): item is T => Boolean(item && typeof item === "object"));
  }

  return venues.filter((item): item is T => {
    if (!item || typeof item !== "object") return false;
    const venue = item as VenueLike;
    return active.every(([key, value]) => {
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
        case "lighting":
          return venue.lighting === value;
        case "petsAllowedIndoors":
          return venue.petsAllowedIndoors === true;
        case "patioOnly":
          return venue.patioOnly === true;
        case "waterBowlsProvided":
          return venue.waterBowlsProvided === true;
        case "dogFriendly":
          return venue.dogFriendly === true;
        case "catsAllowed":
          return venue.catsAllowed === true;
        case "musicStyle":
          return matchesMusicStyle(venue, value as string);
        case "category": {
          if (!value || value === "all") return true;
          const target = String(value).toLowerCase();
          if (
            typeof venue.category === "string" &&
            venue.category.toLowerCase() === target
          ) {
            return true;
          }
          if (Array.isArray(venue.categories)) {
            return venue.categories.some((c: any) => {
              if (typeof c === "string") return c.toLowerCase() === target;
              if (typeof c?.name === "string") return c.name.toLowerCase() === target;
              return false;
            });
          }
          return false;
        }
        case "minCapacity": {
          const targetCapacity = sanitizeCapacityInput(value);
          const cap =
            (venue as any).capacity ??
            (venue as any).meetingRoomCapacity ??
            (venue as any).maxCapacity;
          const capNum = typeof cap === "number" ? cap : Number(cap);
          return !isNaN(capNum) && isFinite(capNum) && capNum >= targetCapacity;
        }
        default:
          return true;
      }
    });
  });
}

export function buildVenueSearchSchema() {
  const shape: Record<string, z.ZodTypeAny> = {
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radius: z.coerce.number().min(100).max(50000).default(5000),
    minLat: z.coerce.number().min(-90).max(90).optional(),
    maxLat: z.coerce.number().min(-90).max(90).optional(),
    minLng: z.coerce.number().min(-180).max(180).optional(),
    maxLng: z.coerce.number().min(-180).max(180).optional(),
    category: z
      .preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : v),
        z.enum(["cafe", "coworking", "library", "all"]).optional(),
      )
      .optional(),
    cities: z.string().optional(),
    query: z.string().optional(),
    minCapacity: z
      .preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : sanitizeCapacityInput(v)),
        z.number().int().min(1).optional(),
      )
      .optional(),
    semanticWeight: z.coerce.number().min(0).max(100).optional(),
    fullTextWeight: z.coerce.number().min(0).max(100).optional(),
  };

  for (const [key, config] of Object.entries(VENUE_FILTERS)) {
    if (config.type === "boolean") {
      shape[key] = z
        .preprocess((v) => {
          if (v === "true" || v === "1" || v === 1) return true;
          if (v === "false" || v === "0" || v === 0) return false;
          if (v === "" || v === null || v === undefined) return undefined;
          return v;
        }, z.boolean().optional())
        .optional();
    } else if (config.type === "enum" && config.values) {
      shape[key] = z
        .preprocess(
          (v) => (v === "" || v === null || v === undefined ? undefined : v),
          z.enum(config.values as unknown as [string, ...string[]]).optional(),
        )
        .optional();
    }
  }

  return z.object(shape);
}

export type VenueSearchFilters = z.infer<
  ReturnType<typeof buildVenueSearchSchema>
>;
