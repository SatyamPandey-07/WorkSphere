import { applyFilters } from "@/lib/filters";
import { prisma } from "@/lib/prisma";
import { haversineKm } from "@/lib/distance";
import {
  GROQ_MODEL,
  GEMINI_MODEL,
  classifyQueryComplexity,
  getProviderForComplexity,
  getFallbackProvider,
  getModelForProvider,
  isGroqConfigured,
  isProviderConfigured,
  getGroqClient,
  isRateLimitError,
  executeProviderCompletion,
  executeProviderStream,
  routeChatCompletion,
  routeChatStream,
  type AIProvider,
  type QueryComplexity,
  type ChatMessage,
  type CompletionOptions,
  type StreamOptions,
  type RoutedResult,
} from "@/lib/ai/providerRouting";
import { getGeminiClient, isGeminiConfigured } from "@/lib/ai/gemini";

export const LLM_MODEL = GROQ_MODEL;

export {
  GROQ_MODEL,
  GEMINI_MODEL,
  classifyQueryComplexity,
  getProviderForComplexity,
  getFallbackProvider,
  getModelForProvider,
  isGroqConfigured,
  isGeminiConfigured,
  isProviderConfigured,
  getGroqClient,
  getGeminiClient,
  isRateLimitError,
  executeProviderCompletion,
  executeProviderStream,
  routeChatCompletion,
  routeChatStream,
  type AIProvider,
  type QueryComplexity,
  type ChatMessage,
  type CompletionOptions,
  type StreamOptions,
  type RoutedResult,
};

/**
 * Patterns that attempt to override or escape the system prompt. Removing
 * them from user input prevents prompt injection before it reaches the LLM.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /you\s+are\s+now\s+/gi,
  /act\s+as\s+(?:an?\s+)?(?:evil|unfiltered|jailbroken|DAN)/gi,
  /\[\s*INST\s*\]/gi, // Llama-2 special token
  /<\|?system\|?>/gi, // system delimiter tag
  /<\|?im_start\|?>/gi, // ChatML start tag
  /<\|?im_end\|?>/gi, // ChatML end tag
];

/**
 * Strips prompt injection patterns from user input and trims whitespace.
 * Returns the sanitized string, capped at 2000 characters to prevent
 * excessively long prompts from inflating context size.
 */
export function sanitizeUserInput(input: string): string {
  let sanitized = input;
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized.trim().slice(0, 2000);
}

export function isLlmConfigured(): boolean {
  return isGroqConfigured() || isGeminiConfigured();
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type WorkType = "focus" | "calls" | "collaboration" | "casual";
export type VenueCategory = "cafe" | "coworking" | "library";

export interface SearchParameters {
  workType: WorkType;
  amenities: string[];
  radius: number;
  category: VenueCategory[];
  location?: { lat: number; lng: number } | null;
}

export interface RawVenue {
  id: string;
  placeId?: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  address: string | null;
  wifi: boolean;
  hasOutlets: boolean;
  noiseLevel: string;
  rating: number | null;
  wifiQuality: number | null;
  openingHours: string | null;
  hasErgonomic: boolean;
  outletDensity: string;
  wifiSpeed: number | null;
  hasPhoneBooths: boolean;
  hasNoMusic: boolean;
  hasQuietZone: boolean;
  hasAncHeadsetRental: boolean;
  source?: "worksphere" | "openstreetmap";
  ratingCount?: number;
  distanceKm?: number;
}

export interface RankedVenue extends RawVenue {
  score: number;
  scoreBreakdown: Record<string, number>;
  highlights: string[];
}

const ALL_CATEGORIES: VenueCategory[] = ["cafe", "coworking", "library"];
const DEFAULT_RADIUS_M = 2000;
const MIN_RADIUS_M = 300;
const MAX_RADIUS_M = 10000;

function clampRadius(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RADIUS_M;
  return Math.round(Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, n)));
}

function normalizeCategories(value: unknown): VenueCategory[] {
  const list = Array.isArray(value) ? value : [value];
  const cats = new Set<VenueCategory>();
  for (const raw of list) {
    const v = String(raw ?? "").toLowerCase();
    if (v.includes("cafe") || v.includes("café") || v.includes("coffee"))
      cats.add("cafe");
    if (v.includes("cowork")) cats.add("coworking");
    if (v.includes("librar")) cats.add("library");
  }
  return cats.size > 0 ? [...cats] : [...ALL_CATEGORIES];
}

function normalizeWorkType(value: unknown): WorkType {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("call") || v.includes("meeting")) return "calls";
  if (v.includes("collab") || v.includes("team") || v.includes("group"))
    return "collaboration";
  if (v.includes("casual")) return "casual";
  return "focus";
}

const KNOWN_AMENITIES = [
  "wifi",
  "outlets",
  "quiet",
  "ergonomic",
  "phone_booths",
  "outdoor",
];

function normalizeAmenities(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  return [
    ...new Set(
      list
        .map((a) =>
          String(a)
            .toLowerCase()
            .replace(/[\s-]+/g, "_"),
        )
        .map((a) => (a === "wi_fi" || a === "internet" ? "wifi" : a))
        .filter((a) => KNOWN_AMENITIES.includes(a)),
    ),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic query understanding (used when no LLM is configured, and as a
// safety net when the LLM returns something unusable)
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_HINTS =
  /\b(find|search|show|looking|look for|need|want|where|recommend|suggest|near|nearby|around|close|best|spot|place|places|workspace|work from|work at|study|desk|cafe|café|coffee|cowork\w*|librar\w*|wifi|wi-fi|quiet|outlet|power|plug)\b/i;

export function parseSearchQuery(message: string): {
  isSearch: boolean;
  parameters: SearchParameters;
} {
  const text = message.toLowerCase();

  const categories: VenueCategory[] = [];
  if (/\b(cafe|café|cafes|cafés|coffee)\b/.test(text)) categories.push("cafe");
  if (/\bco-?work\w*|\bshared office|\bhot ?desk/.test(text))
    categories.push("coworking");
  if (/\blibrar\w*/.test(text)) categories.push("library");

  const amenities: string[] = [];
  if (/\b(wi-?fi|internet|fast connection|bandwidth)\b/.test(text))
    amenities.push("wifi");
  if (/\b(outlet|outlets|power|plug|socket|charg\w*)\b/.test(text))
    amenities.push("outlets");
  if (/\b(quiet|silent|calm|peaceful|focus\w*|deep work)\b/.test(text))
    amenities.push("quiet");
  if (/\b(ergonomic|standing desk|good chair|monitor)\b/.test(text))
    amenities.push("ergonomic");
  if (/\b(phone booth|call booth)\b/.test(text)) amenities.push("phone_booths");
  if (/\b(outdoor|patio|terrace)\b/.test(text)) amenities.push("outdoor");

  let workType: WorkType = "focus";
  if (/\b(call|calls|zoom|meet|meeting|interview|phone)\b/.test(text)) {
    workType = "calls";
    if (!amenities.includes("phone_booths")) amenities.push("phone_booths");
  } else if (/\b(team|group|collab\w*|brainstorm|friends)\b/.test(text)) {
    workType = "collaboration";
  } else if (/\b(casual|chill|relax\w*|hang)\b/.test(text)) {
    workType = "casual";
  }

  let radius = DEFAULT_RADIUS_M;
  const distance = text.match(
    /(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|mi|miles?|m|meters?|metres?)\b/,
  );
  if (distance) {
    const value = parseFloat(distance[1]);
    const unit = distance[2];
    radius = unit.startsWith("k")
      ? value * 1000
      : unit.startsWith("mi")
        ? value * 1609
        : value;
  } else if (/\bwalking distance\b/.test(text)) {
    radius = 1000;
  } else if (
    /\b(near me|nearby|close by|closest|nearest|around here)\b/.test(text)
  ) {
    radius = 1500;
  }

  return {
    isSearch:
      SEARCH_HINTS.test(text) || categories.length > 0 || amenities.length > 0,
    parameters: {
      workType,
      amenities,
      radius: clampRadius(radius),
      category: categories.length > 0 ? categories : [...ALL_CATEGORIES],
    },
  };
}

function extractJson(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 1: ORCHESTRATOR — search or conversation? simple or detailed?
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorDecision {
  agentsToUse: string[];
  reasoning: string;
  skipAgents: boolean;
  complexity?: "simple" | "complex";
  parameters?: Partial<SearchParameters>;
}

export async function orchestratorAgent(
  rawUserMessage: string,
  context?: unknown,
): Promise<OrchestratorDecision> {
  const userMessage = sanitizeUserInput(rawUserMessage);
  const heuristic = parseSearchQuery(userMessage);
  const complexity = classifyQueryComplexity(userMessage, context);

  const heuristicDecision = (): OrchestratorDecision => {
    if (!heuristic.isSearch) {
      return {
        agentsToUse: [],
        skipAgents: true,
        reasoning: "General conversation",
        complexity,
      };
    }
    const detailed =
      heuristic.parameters.amenities.length > 0 ||
      heuristic.parameters.workType !== "focus" ||
      complexity === "complex";
    return {
      agentsToUse: detailed
        ? ["ContextAgent", "DataAgent", "ReasoningAgent", "ActionAgent"]
        : ["DataAgent", "ReasoningAgent", "ActionAgent"],
      skipAgents: false,
      complexity: detailed ? "complex" : "simple",
      reasoning: detailed
        ? "Search with specific needs"
        : "Basic category search",
      parameters: heuristic.parameters,
    };
  };

  if (!isLlmConfigured()) return heuristicDecision();

  const systemPrompt = `You route messages for WorkSphere, an app that finds places to work (cafes, coworking spaces, libraries).
Decide whether the message is a workspace search or general conversation.
- "simple": a basic category search ("cafes near me", "coworking in Brooklyn").
- "complex": specific needs ("quiet cafe with fast wifi for zoom calls").
Output ONLY JSON:
{"skipAgents": false, "complexity": "simple" | "complex", "reasoning": "...", "parameters": {"workType": "focus|calls|collaboration|casual", "category": ["cafe","coworking","library"], "amenities": [], "radius": 2000}}
For general conversation: {"skipAgents": true, "reasoning": "General conversation"}`;

  try {
    const { text: content } = await routeChatCompletion({
      complexity,
      userQuery: userMessage,
      context,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Message: ${JSON.stringify(userMessage)}\nContext: ${context ? JSON.stringify(context) : "None"}`,
        },
      ],
      temperature: 0.2,
    });
    const parsed = extractJson(content || "");
    if (parsed && typeof parsed === "object") {
      if (parsed.skipAgents === true) {
        return {
          agentsToUse: [],
          skipAgents: true,
          reasoning: String(parsed.reasoning ?? "General conversation"),
          complexity,
        };
      }
      const resolvedComplexity =
        parsed.complexity === "simple" || parsed.complexity === "complex"
          ? parsed.complexity
          : complexity;
      return {
        agentsToUse:
          resolvedComplexity === "simple"
            ? ["DataAgent", "ReasoningAgent", "ActionAgent"]
            : ["ContextAgent", "DataAgent", "ReasoningAgent", "ActionAgent"],
        skipAgents: false,
        complexity: resolvedComplexity,
        reasoning: String(parsed.reasoning ?? ""),
        parameters: parsed.parameters
          ? {
              workType: normalizeWorkType(parsed.parameters.workType),
              category: normalizeCategories(parsed.parameters.category),
              amenities: normalizeAmenities(parsed.parameters.amenities),
              radius: clampRadius(parsed.parameters.radius),
            }
          : heuristic.parameters,
      };
    }
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    console.error("Orchestrator error:", error);
  }

  return heuristicDecision();
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 2: CONTEXT — detailed parameter extraction (uses saved preferences)
// ─────────────────────────────────────────────────────────────────────────────

export async function contextAgent(
  rawUserMessage: string,
  userLocation?: { lat: number; lng: number },
  userId?: string | null,
): Promise<{
  intent: string;
  parameters: SearchParameters;
  reasoning: string;
}> {
  const userMessage = sanitizeUserInput(rawUserMessage);
  const heuristic = parseSearchQuery(userMessage).parameters;
  const fallback = {
    intent: "find_workspaces",
    parameters: { ...heuristic, location: userLocation ?? null },
    reasoning: "Parsed from keywords",
  };

  if (!isLlmConfigured()) return fallback;

  let preferences = "";
  if (userId) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { preferencesSummary: true },
      });
      if (dbUser?.preferencesSummary) {
        preferences = `\nThe user's saved preferences (use only to fill gaps): ${dbUser.preferencesSummary.slice(0, 800)}`;
      }
    } catch (e) {
      console.error("Error fetching user preferences:", e);
    }
  }

  const systemPrompt = `Extract workspace search parameters from the user's message.${preferences}
Output ONLY JSON:
{"intent": "short description", "parameters": {"workType": "focus|calls|collaboration|casual", "amenities": ["wifi","outlets","quiet","ergonomic","phone_booths","outdoor"], "radius": 2000, "category": ["cafe","coworking","library"]}, "reasoning": "one sentence"}
radius is in meters (nearby=1500, "2 miles"=3200). Use all three categories unless the user names specific ones.`;

  try {
    const { text: content } = await routeChatCompletion({
      complexity: "complex",
      userQuery: userMessage,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userMessage) },
      ],
      temperature: 0.2,
    });
    const parsed = extractJson(content || "");
    if (parsed?.parameters) {
      return {
        intent: String(parsed.intent ?? "find_workspaces").slice(0, 200),
        parameters: {
          workType: normalizeWorkType(parsed.parameters.workType),
          amenities: normalizeAmenities(parsed.parameters.amenities),
          radius: clampRadius(parsed.parameters.radius),
          category: normalizeCategories(parsed.parameters.category),
          location: userLocation ?? null,
        },
        reasoning: String(parsed.reasoning ?? "").slice(0, 300),
      };
    }
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    console.error("Context agent error:", error);
  }

  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 3: DATA — WorkSphere venues + live OpenStreetMap places
// ─────────────────────────────────────────────────────────────────────────────

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 4000;
const OSM_AMENITY: Record<VenueCategory, string> = {
  cafe: "cafe",
  coworking: "coworking_space",
  library: "library",
};

function osmCategory(amenity?: string): string {
  if (amenity === "coworking_space") return "coworking";
  return amenity || "cafe";
}

async function fetchOsmVenues(
  location: { lat: number; lng: number },
  radius: number,
  categories: VenueCategory[],
): Promise<RawVenue[] | null> {
  const amenityRegex = categories.map((c) => OSM_AMENITY[c]).join("|");
  const around = `(around:${radius},${location.lat},${location.lng})`;
  const query = `[out:json][timeout:10];(node["amenity"~"^(${amenityRegex})$"]${around};way["amenity"~"^(${amenityRegex})$"]${around};node["office"="coworking"]${around};);out center 60;`;

  const result = await Promise.any(
    OVERPASS_ENDPOINTS.map(async (endpoint) => {
      const res = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "WorkSphere/1.0 (+https://github.com/SatyamPandey-07/WorkSphere)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
      return res.json();
    }),
  ).catch(() => null);

  if (!result || !Array.isArray(result.elements)) return null;

  return result.elements
    .filter(
      (el: any) => el.tags?.name && (el.lat ?? el.center?.lat) !== undefined,
    )
    .map((el: any): RawVenue => {
      const tags = el.tags ?? {};
      const amenity =
        tags.amenity ??
        (tags.office === "coworking" ? "coworking_space" : undefined);
      const speedTag = tags["internet_access:speed"] || tags["download:speed"];
      const speedMatch =
        typeof speedTag === "string" ? speedTag.match(/\d+/) : null;
      const socketCount = parseInt(tags["socket:count"] || "0", 10);
      const hasSockets =
        tags.socket === "yes" ||
        tags["power:outlet"] === "yes" ||
        socketCount > 0;
      const isCoworking = amenity === "coworking_space";
      const outletDensity =
        socketCount > 10 || isCoworking
          ? "every_table"
          : hasSockets
            ? "some_tables"
            : amenity === "library"
              ? "wall_seats"
              : "none";
      const address = tags["addr:street"]
        ? [
            `${tags["addr:housenumber"] ?? ""} ${tags["addr:street"]}`.trim(),
            tags["addr:city"],
          ]
            .filter(Boolean)
            .join(", ")
        : null;

      return {
        id: String(el.id),
        placeId: String(el.id),
        name: String(tags.name),
        lat: el.lat ?? el.center?.lat,
        lng: el.lon ?? el.center?.lon,
        category: osmCategory(amenity),
        address,
        wifi: ["wlan", "yes", "wifi"].includes(tags.internet_access),
        hasOutlets: hasSockets || isCoworking,
        noiseLevel: amenity === "library" ? "quiet" : "unknown",
        rating: null,
        wifiQuality: null,
        openingHours: tags.opening_hours || null,
        hasErgonomic: isCoworking,
        outletDensity,
        wifiSpeed: speedMatch ? parseInt(speedMatch[0], 10) : null,
        hasPhoneBooths: false,
        hasNoMusic: false,
        hasQuietZone: amenity === "library",
        hasAncHeadsetRental: false,
        source: "openstreetmap",
      };
    });
}

async function fetchDbVenues(
  location: { lat: number; lng: number },
  radius: number,
  categories: VenueCategory[],
): Promise<RawVenue[]> {
  const latDelta = radius / 1000 / 111;
  const lngDelta =
    radius /
    1000 /
    (111 * Math.max(0.1, Math.cos((location.lat * Math.PI) / 180)));
  const dbCategories = categories.flatMap((c) =>
    c === "coworking" ? ["coworking", "coworking_space"] : [c],
  );

  const venues = await prisma.venue.findMany({
    where: {
      latitude: { gte: location.lat - latDelta, lte: location.lat + latDelta },
      longitude: { gte: location.lng - lngDelta, lte: location.lng + lngDelta },
      category: { in: dbCategories },
      requiresReview: false,
    },
    include: { _count: { select: { ratings: true } } },
    take: 80,
  });

  return venues.map((v) => ({
    id: v.id,
    placeId: v.placeId,
    name: v.name,
    lat: v.latitude,
    lng: v.longitude,
    category: osmCategory(v.category),
    address: v.address,
    wifi: (v.wifiQuality ?? 0) >= 3 || (v.wifiSpeed ?? 0) > 0,
    hasOutlets: v.hasOutlets,
    noiseLevel: v.noiseLevel ?? "unknown",
    rating: v.rating,
    wifiQuality: v.wifiQuality,
    openingHours: v.openingHours ?? null,
    hasErgonomic: v.hasErgonomic,
    outletDensity: v.outletDensity ?? (v.hasOutlets ? "some_tables" : "none"),
    wifiSpeed: v.wifiSpeed,
    hasPhoneBooths: v.hasPhoneBooths,
    hasNoMusic: v.hasNoMusic,
    hasQuietZone: v.hasQuietZone,
    hasAncHeadsetRental: v.hasAncHeadsetRental,
    source: "worksphere",
    ratingCount: v._count.ratings,
  }));
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function dataAgent(
  params: Partial<SearchParameters> & {
    location?: { lat: number; lng: number } | null;
  },
  filters?: Record<string, unknown>,
): Promise<{
  venues: RawVenue[];
  meta: {
    total: number;
    source: string;
    highTraffic?: boolean;
    sources: { worksphere: number; openstreetmap: number };
  };
  reasoning: string;
}> {
  const location = params.location;
  if (
    !location ||
    typeof location.lat !== "number" ||
    typeof location.lng !== "number"
  ) {
    return {
      venues: [],
      meta: {
        total: 0,
        source: "none",
        sources: { worksphere: 0, openstreetmap: 0 },
      },
      reasoning: "No location provided",
    };
  }

  const radius = clampRadius(params.radius);
  const categories = normalizeCategories(params.category);

  const [dbVenues, osmVenues] = await Promise.all([
    fetchDbVenues(location, radius, categories).catch((err) => {
      console.error("[DataAgent] DB venue lookup failed:", err);
      return [] as RawVenue[];
    }),
    fetchOsmVenues(location, radius, categories).catch(() => null),
  ]);

  // WorkSphere records carry crowd-sourced ratings, so they win over the
  // same place coming back from OpenStreetMap.
  const merged: RawVenue[] = [...dbVenues];
  const knownPlaceIds = new Set(dbVenues.map((v) => v.placeId));
  for (const osm of osmVenues ?? []) {
    if (knownPlaceIds.has(osm.placeId)) continue;
    const duplicate = dbVenues.some(
      (db) =>
        normalizeName(db.name) === normalizeName(osm.name) &&
        haversineKm(db.lat, db.lng, osm.lat, osm.lng) < 0.08,
    );
    if (!duplicate) merged.push(osm);
  }

  for (const venue of merged) {
    venue.distanceKm =
      Math.round(
        haversineKm(location.lat, location.lng, venue.lat, venue.lng) * 100,
      ) / 100;
  }

  const filtered = (filters ? applyFilters(merged, filters as any) : merged)
    .filter((v) => (v.distanceKm ?? 0) <= (radius / 1000) * 1.05)
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
    .slice(0, 40);

  const sources = {
    worksphere: filtered.filter((v) => v.source === "worksphere").length,
    openstreetmap: filtered.filter((v) => v.source === "openstreetmap").length,
  };

  return {
    venues: filtered,
    meta: {
      total: filtered.length,
      source: osmVenues === null ? "WorkSphere" : "WorkSphere + OpenStreetMap",
      highTraffic: osmVenues === null,
      sources,
    },
    reasoning:
      osmVenues === null
        ? `Found ${filtered.length} WorkSphere venues within ${radius}m (OpenStreetMap was unavailable)`
        : `Found ${filtered.length} venues within ${radius}m`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 4: REASONING — consistent 0–10 scoring with explanations
// ─────────────────────────────────────────────────────────────────────────────

const WEIGHTS: Record<
  WorkType,
  {
    wifi: number;
    noise: number;
    outlets: number;
    rating: number;
    distance: number;
  }
> = {
  focus: { wifi: 0.2, noise: 0.3, outlets: 0.2, rating: 0.15, distance: 0.15 },
  calls: {
    wifi: 0.35,
    noise: 0.25,
    outlets: 0.1,
    rating: 0.15,
    distance: 0.15,
  },
  collaboration: {
    wifi: 0.25,
    noise: 0.1,
    outlets: 0.2,
    rating: 0.25,
    distance: 0.2,
  },
  casual: {
    wifi: 0.2,
    noise: 0.15,
    outlets: 0.15,
    rating: 0.25,
    distance: 0.25,
  },
};

function wifiScore(v: RawVenue): number {
  if (v.wifiSpeed && v.wifiSpeed > 0) {
    return v.wifiSpeed >= 100
      ? 10
      : v.wifiSpeed >= 50
        ? 8.5
        : v.wifiSpeed >= 20
          ? 7
          : 5;
  }
  if (v.wifiQuality) return Math.min(10, v.wifiQuality * 2);
  return v.wifi ? 6.5 : 4;
}

function noiseScore(v: RawVenue): number {
  if (v.noiseLevel === "quiet") return 9;
  if (v.noiseLevel === "moderate") return 6;
  if (v.noiseLevel === "loud") return 2.5;
  return 5;
}

function outletScore(v: RawVenue): number {
  switch (v.outletDensity) {
    case "every_table":
      return 9.5;
    case "some_tables":
      return 7;
    case "wall_seats":
      return 6;
    default:
      return v.hasOutlets ? 6.5 : 4;
  }
}

function distanceScore(
  distanceKm: number | undefined,
  radiusKm: number,
): number {
  if (distanceKm === undefined) return 5;
  return Math.max(2, 10 - (distanceKm / Math.max(radiusKm, 0.3)) * 8);
}

function highlightsFor(v: RawVenue): string[] {
  const out: string[] = [];
  if (v.distanceKm !== undefined) {
    out.push(
      v.distanceKm < 1
        ? `${Math.round(v.distanceKm * 1000)} m away`
        : `${v.distanceKm.toFixed(1)} km away`,
    );
  }
  if (v.wifiSpeed) out.push(`Wi-Fi ~${v.wifiSpeed} Mbps`);
  else if (v.wifiQuality && v.wifiQuality >= 4) out.push("Strong Wi-Fi");
  else if (v.wifi) out.push("Wi-Fi");
  if (v.noiseLevel === "quiet") out.push("Quiet");
  if (v.outletDensity === "every_table") out.push("Outlets at every table");
  else if (v.hasOutlets) out.push("Power outlets");
  if (v.hasPhoneBooths) out.push("Phone booths");
  if (v.hasErgonomic) out.push("Ergonomic seating");
  if (v.rating) out.push(`Rated ${v.rating.toFixed(1)}`);
  if (v.ratingCount)
    out.push(`${v.ratingCount} review${v.ratingCount === 1 ? "" : "s"}`);
  return out;
}

export function reasoningAgent(
  venues: RawVenue[],
  preferences: { workType?: string; amenities?: string[]; radius?: number },
): {
  rankedVenues: RankedVenue[];
  summary: string;
  reasoning: string;
} {
  const workType = normalizeWorkType(preferences.workType);
  const amenities = normalizeAmenities(preferences.amenities ?? []);
  const radiusKm = clampRadius(preferences.radius) / 1000;
  const w = WEIGHTS[workType];

  const ranked = venues.map((venue) => {
    const breakdown = {
      wifi: wifiScore(venue),
      noise: noiseScore(venue),
      outlets: outletScore(venue),
      rating: venue.rating ? Math.min(10, venue.rating * 2) : 5,
      distance: distanceScore(venue.distanceKm, radiusKm),
    };

    let score =
      breakdown.wifi * w.wifi +
      breakdown.noise * w.noise +
      breakdown.outlets * w.outlets +
      breakdown.rating * w.rating +
      breakdown.distance * w.distance;

    // Reward explicitly requested amenities the venue is known to have,
    // and penalise ones it is known to lack.
    for (const amenity of amenities) {
      const has =
        amenity === "wifi"
          ? breakdown.wifi >= 6.5
          : amenity === "outlets"
            ? venue.hasOutlets
            : amenity === "quiet"
              ? venue.noiseLevel === "quiet"
              : amenity === "ergonomic"
                ? venue.hasErgonomic
                : amenity === "phone_booths"
                  ? venue.hasPhoneBooths
                  : false;
      const knownMissing =
        (amenity === "quiet" && venue.noiseLevel === "loud") ||
        (amenity === "outlets" &&
          venue.outletDensity === "none" &&
          venue.source === "worksphere");
      if (has) score += 0.4;
      else if (knownMissing) score -= 0.6;
    }

    return {
      ...venue,
      score: Math.max(0, Math.min(10, Math.round(score * 10) / 10)),
      scoreBreakdown: breakdown,
      highlights: highlightsFor(venue),
    };
  });

  ranked.sort(
    (a, b) => b.score - a.score || (a.distanceKm ?? 0) - (b.distanceKm ?? 0),
  );

  const top = ranked[0];
  return {
    rankedVenues: ranked,
    summary: top
      ? `Top pick: ${top.name} (score ${top.score}/10)`
      : "No venues found",
    reasoning: `Scored ${ranked.length} venues for ${workType} work (Wi-Fi ${Math.round(w.wifi * 100)}%, noise ${Math.round(w.noise * 100)}%, outlets ${Math.round(w.outlets * 100)}%, rating ${Math.round(w.rating * 100)}%, distance ${Math.round(w.distance * 100)}%).`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 5: ACTION — map markers, reply text and follow-up suggestions
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  cafe: "cafe",
  coworking: "coworking space",
  library: "library",
};

export async function actionAgent(
  rankedVenues: Array<RawVenue & { score: number; highlights?: string[] }>,
  _userQuery: string,
  meta?: { highTraffic?: boolean; radius?: number },
): Promise<{
  message: string;
  mapUpdates: {
    markers: Array<Record<string, unknown>>;
    view: {
      center: { lat: number; lng: number };
      zoom: number;
      animate: boolean;
    };
  };
  suggestions: string[];
}> {
  const top = rankedVenues.slice(0, 5);
  const lines = top.map((v, i) => {
    const details = (v.highlights ?? []).slice(0, 4).join(" · ");
    return `${i + 1}. **${v.name}** — ${CATEGORY_LABEL[v.category] ?? v.category}, ${v.score}/10${details ? `\n   ${details}` : ""}`;
  });

  let message: string;
  if (rankedVenues.length === 0) {
    message =
      "I couldn't find matching workspaces in this area. Try widening the distance, removing a filter, or searching a different neighbourhood.";
  } else {
    message = `Here ${rankedVenues.length === 1 ? "is the best match" : `are the top ${top.length} of ${rankedVenues.length} places`} near you:\n\n${lines.join("\n")}\n\nThey're pinned on the map — tap one for details, directions or to book.`;
  }
  if (meta?.highTraffic) {
    message +=
      "\n\n_Live OpenStreetMap data is unavailable right now, so results only include venues in the WorkSphere directory._";
  }

  const markers = rankedVenues.slice(0, 15).map((v) => ({
    id: v.id,
    lat: v.lat,
    lng: v.lng,
    name: v.name,
    category: v.category,
    address: v.address,
    wifi: v.wifi,
    hasOutlets: v.hasOutlets,
    noiseLevel: v.noiseLevel,
    score: v.score,
  }));

  const center =
    markers.length > 0
      ? {
          lat:
            markers.reduce((s, m) => s + (m.lat as number), 0) / markers.length,
          lng:
            markers.reduce((s, m) => s + (m.lng as number), 0) / markers.length,
        }
      : { lat: 0, lng: 0 };

  const suggestions =
    rankedVenues.length === 0
      ? ["Search within 5 km", "Show any cafes nearby", "Show libraries nearby"]
      : [
          "Only quiet places",
          "Places good for video calls",
          "Show coworking spaces",
          `Directions to ${rankedVenues[0].name}`,
        ];

  return {
    message,
    mapUpdates: { markers, view: { center, zoom: 14, animate: true } },
    suggestions,
  };
}

/** Friendly reply for non-search messages when no LLM is configured. */
export function offlineConversationReply(message: string): string {
  const text = message.toLowerCase();
  if (/\b(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(text)) {
    return "Hi! I can find cafes, coworking spaces and libraries that are good for working. Try “quiet cafe with outlets near me” or “coworking space within 3 km”.";
  }
  if (/\b(thanks|thank you|cheers)\b/.test(text)) {
    return "You're welcome! Let me know if you want to find another spot.";
  }
  return "I'm best at finding places to work. Tell me what you need — for example “library near me”, “cafe with fast Wi-Fi for calls”, or “coworking space within 2 km”.";
}
