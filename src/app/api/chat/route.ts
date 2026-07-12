import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { chatRequestSchema, validateRequest } from "@/lib/validations";
import { checkSemanticCache, setSemanticCache } from "@/lib/cache/semanticCache";
import { extractAndStoreMemories, updateUserPreferencesSummary } from "@/lib/agents/MemoryAgent";

export const maxDuration = 60;

// Lazy init Groq client to avoid build-time errors
let groq: Groq | null = null;
function getGroqClient(): Groq {
  if (!groq) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY || '',
      // Explicit bounds so sustained rate-limit exhaustion (HTTP 429)
      // fails fast with a catchable error instead of the SDK's default
      // internal retry behavior hanging the request indefinitely,
      // which was surfacing as an infinite loading state on the client.
      maxRetries: 2,
      timeout: 20000, // 20s
    });
  }
  return groq;
}

// ============================================================
// AGENT 1: ORCHESTRATOR - Determines which agents to use
// ============================================================
async function orchestratorAgent(
  userMessage: string,
  context?: any
): Promise<{
  agentsToUse: string[];
  reasoning: string;
  skipAgents: boolean;
  complexity?: "simple" | "complex";
  parameters?: {
    workType?: string;
    amenities?: string[];
    location?: string;
  };
}> {
  const systemPrompt = `You are the Orchestrator Agent for WorkHub. Analyze user messages and determine which agents are needed.

Available agents:
- ContextAgent: Extracts search parameters (workType, amenities, location)
- DataAgent: Fetches venue data
- ReasoningAgent: Scores and ranks venues
- ActionAgent: Updates map UI and generates responses

Rules:
1. Finding/searching workspaces → Use agents.
2. Determine "complexity". If the user is just asking for a basic category (e.g., "cafes in Brooklyn", "coworking spaces near me"), it is "simple". If they specify exact needs (e.g., "quiet cafe with fast wifi for zoom calls"), it is "complex".
3. If "complexity" is "simple", you must provide "parameters" with basic workType (e.g., "cafe") and location.
4. Asking about specific venue → DataAgent + ActionAgent
5. Directions to venue → ActionAgent only
6. General conversation → Skip agents

Output ONLY valid JSON:
{"agentsToUse": ["ContextAgent", "DataAgent", "ReasoningAgent", "ActionAgent"], "reasoning": "Complex requirements", "skipAgents": false, "complexity": "complex"}

For simple searches: {"agentsToUse": ["DataAgent", "ActionAgent"], "reasoning": "Simple search", "skipAgents": false, "complexity": "simple", "parameters": {"workType": "cafe", "location": "Brooklyn", "amenities": []}}

For general chat: {"skipAgents": true, "reasoning": "General conversation"}`;

  try {
    const response = await getGroqClient().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `User message: "${userMessage}"\nContext: ${context ? JSON.stringify(context) : "None"}\nNote: This is a multiplayer session.` },
      ],
      temperature: 0.3,
    });

    const text = response.choices[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Orchestrator error:", error);
  }

  return {
    agentsToUse: ["ContextAgent", "DataAgent", "ReasoningAgent", "ActionAgent"],
    reasoning: "Defaulting to full pipeline",
    skipAgents: false,
  };
}

// ============================================================
// AGENT 2: CONTEXT - Extracts search parameters from user intent
// ============================================================
async function contextAgent(
  userMessage: string,
  userLocation?: { lat: number; lng: number },
  userId?: string | null
): Promise<{
  intent: string;
  parameters: {
    workType: string;
    amenities: string[];
    location: any;
    radius: number;
    category: string[];
    timeOfDay?: string;
    duration?: number;
  };
  reasoning: string;
}> {
  let memoryContext = "";
  if (userId) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { preferencesSummary: true }
      });
      if (dbUser?.preferencesSummary) {
        memoryContext += `\n\nUSER PROFILE PREFERENCES SUMMARY (Must be considered): ${dbUser.preferencesSummary}`;
      }

      if (process.env.COHERE_API_KEY) {
        const embedRes = await fetch('https://api.cohere.ai/v1/embed', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            texts: [userMessage],
            model: 'embed-english-v3.0',
            input_type: 'search_query',
          }),
        });

        if (embedRes.ok) {
          const embedData = await embedRes.json();
          const embedding = embedData.embeddings[0];
          const embeddingString = `[${embedding.join(',')}]`;

          const memories: any[] = await prisma.$queryRawUnsafe(`
            SELECT content, 1 - (embedding <=> $1::vector) AS similarity
            FROM "UserMemory"
            WHERE "userId" = $2
            ORDER BY embedding <=> $1::vector
            LIMIT 3
          `, embeddingString, userId);

          if (memories.length > 0) {
            memoryContext += "\n\nRECENT SEMANTIC USER MEMORIES:\n" + memories.map(m => `- ${m.content}`).join("\n");
          }
        }
      }
    } catch (e) {
      console.error('Error fetching AI memories:', e);
    }
  }

  const systemPrompt = `You are the Context Agent. Extract search parameters from user queries.${memoryContext}

Extract:
1. workType: "focus" | "calls" | "collaboration" | "casual"
2. amenities: ["wifi", "outlets", "quiet", "parking", "outdoor"]
3. radius: meters (nearby=1000, close=2000, "2 miles"=3200)
4. category: ["cafe", "coworking", "library"]
5. timeOfDay: "morning" | "afternoon" | "evening" | null
6. duration: minutes

Output ONLY valid JSON:
{"intent": "Find quiet cafe", "parameters": {"workType": "focus", "amenities": ["wifi", "quiet"], "radius": 2000, "category": ["cafe", "coworking"], "timeOfDay": null, "duration": 120}, "reasoning": "User needs quiet focus space"}`;

  try {
    const response = await getGroqClient().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Message: "${userMessage}"\nLocation: ${userLocation ? `${userLocation.lat}, ${userLocation.lng}` : "unknown"}` },
      ],
      temperature: 0.4,
    });

    const text = response.choices[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      result.parameters.location = userLocation || null;
      return result;
    }
  } catch (error) {
    console.error("Context agent error:", error);
  }

  return {
    intent: userMessage,
    parameters: {
      workType: "focus",
      amenities: ["wifi"],
      location: userLocation,
      radius: 2000,
      category: ["cafe", "coworking", "library"],
    },
    reasoning: "Default parameters",
  };
}

// ============================================================
// AGENT 3: DATA - Fetches venues from Overpass API
// ============================================================
async function dataAgent(
  params: any,
  filters?: {
    wifi?: boolean;
    outlets?: boolean;
    quiet?: boolean;
    ergonomic?: boolean;
    outletDensity?: string;
    wifiSpeedBand?: string;
  }
): Promise<{
  venues: any[];
  meta: { total: number; source: string; highTraffic?: boolean };
  reasoning: string;
}> {
  const { location, radius = 2000, category: _category = ["all"] } = params;

  if (!location?.lat || !location?.lng) {
    return {
      venues: [],
      meta: { total: 0, source: "none" },
      reasoning: "No location provided",
    };
  }

  const categoryMap: Record<string, string> = {
    cafe: '["amenity"="cafe"]',
    coworking: '["amenity"="coworking_space"]',
    library: '["amenity"="library"]',
    all: '["amenity"~"cafe|coworking_space|library"]',
  };

  const query = `
    [out:json][timeout:25];
    (
      node${categoryMap.all}(around:${radius},${location.lat},${location.lng});
      way${categoryMap.all}(around:${radius},${location.lat},${location.lng});
    );
    out center body;
  `;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
  ];

  let overpassFailed = true;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      if (!response.ok) continue;
      const data = await response.json();
      overpassFailed = false;

      let venues = data.elements.slice(0, 15).map((el: any) => {
        const hasErgonomic = el.tags?.office === "coworking" || el.tags?.ergonomic === "yes" || el.tags?.standing_desk === "yes" || el.tags?.backrest === "yes" || el.tags?.amenity === "coworking_space";
        let wifiSpeed: number | null = null;
        const speedTag = el.tags?.["internet_access:speed"] || el.tags?.["download:speed"];
        if (speedTag) {
          const match = speedTag.match(/\d+/);
          if (match) {
            wifiSpeed = parseInt(match[0], 10);
          }
        }

        let outletDensity = "none";
        if (el.tags?.socket === "yes" || el.tags?.["socket:count"] || el.tags?.["power:outlet"] === "yes") {
          outletDensity = "some_tables";
          const count = parseInt(el.tags?.["socket:count"] || "0", 10);
          if (count > 10) {
            outletDensity = "every_table";
          }
        } else if (el.tags?.amenity === "coworking_space") {
          outletDensity = "every_table";
        } else if (el.tags?.amenity === "library") {
          outletDensity = "wall_seats";
        }

        return {
          id: el.id.toString(),
          name: el.tags?.name || "Unknown Venue",
          lat: el.lat || el.center?.lat,
          lng: el.lon || el.center?.lon,
          category: el.tags?.amenity || "venue",
          address: el.tags?.["addr:street"]
            ? `${el.tags["addr:housenumber"] || ""} ${el.tags["addr:street"]}`.trim()
            : null,
          wifi: el.tags?.internet_access === "wlan" || el.tags?.internet_access === "yes",
          hasOutlets: el.tags?.socket === "yes" || el.tags?.["socket:count"] || el.tags?.internet_access ? true : false,
          noiseLevel: el.tags?.amenity === "library" ? "quiet" : "moderate",
          rating: null,
          wifiQuality: el.tags?.internet_access ? 3 : null,
          openingHours: el.tags?.opening_hours || null,
          hasErgonomic,
          outletDensity,
          wifiSpeed,
        };
      });

      // Apply filters if provided
      if (filters) {
        if (filters.wifi) venues = venues.filter((v: any) => v.wifi);
        if (filters.outlets) venues = venues.filter((v: any) => v.hasOutlets);
        if (filters.quiet) venues = venues.filter((v: any) => v.noiseLevel === "quiet");
        if (filters.ergonomic) venues = venues.filter((v: any) => v.hasErgonomic);
        if (filters.outletDensity && filters.outletDensity !== "none") {
          if (filters.outletDensity === "every_table") {
            venues = venues.filter((v: any) => v.outletDensity === "every_table");
          } else if (filters.outletDensity === "some_tables") {
            venues = venues.filter((v: any) => ["every_table", "some_tables"].includes(v.outletDensity));
          } else if (filters.outletDensity === "wall_seats") {
            venues = venues.filter((v: any) => ["every_table", "some_tables", "wall_seats"].includes(v.outletDensity));
          }
        }
        if (filters.wifiSpeedBand && filters.wifiSpeedBand !== "all") {
          if (filters.wifiSpeedBand === "basic") {
            venues = venues.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 10);
          } else if (filters.wifiSpeedBand === "fast") {
            venues = venues.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 50);
          } else if (filters.wifiSpeedBand === "ultra") {
            venues = venues.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 100);
          }
        }
      }

      return {
        venues,
        meta: { total: venues.length, source: "Overpass API" },
        reasoning: `Found ${venues.length} venues within ${radius}m`,
      };
    } catch (error) {
      console.error("Data agent error:", error);
      continue;
    }
  }

  // Fallback to mock data if Overpass API is completely down/rate-limited
  console.log("Using mock data fallback for location:", location);
  const mockVenues = [
    {
      id: "mock-1",
      name: "Downtown Creative Coworking",
      lat: location.lat + 0.002,
      lng: location.lng - 0.002,
      category: "coworking_space",
      address: "123 Main St, Tech District",
      wifi: true,
      hasOutlets: true,
      noiseLevel: "quiet",
      rating: 4.8,
      wifiQuality: 5,
      openingHours: "08:00-22:00",
      hasErgonomic: true,
      outletDensity: "every_table",
      wifiSpeed: 120,
    },
    {
      id: "mock-2",
      name: "The Daily Grind Cafe",
      lat: location.lat - 0.003,
      lng: location.lng + 0.001,
      category: "cafe",
      address: "456 Oak Avenue",
      wifi: true,
      hasOutlets: true,
      noiseLevel: "moderate",
      rating: 4.2,
      wifiQuality: 4,
      openingHours: "07:00-19:00",
      hasErgonomic: false,
      outletDensity: "some_tables",
      wifiSpeed: 45,
    },
    {
      id: "mock-3",
      name: "City Central Library",
      lat: location.lat + 0.001,
      lng: location.lng + 0.003,
      category: "library",
      address: "789 Library Plaza",
      wifi: true,
      hasOutlets: true,
      noiseLevel: "quiet",
      rating: 4.6,
      wifiQuality: 3,
      openingHours: "09:00-20:00",
      hasErgonomic: false,
      outletDensity: "wall_seats",
      wifiSpeed: 15,
    },
  ];

  // Apply filters to mock data as well so the user can test filters
  let filteredMock = mockVenues;
  if (filters) {
    if (filters.wifi) filteredMock = filteredMock.filter((v: any) => v.wifi);
    if (filters.outlets) filteredMock = filteredMock.filter((v: any) => v.hasOutlets);
    if (filters.quiet) filteredMock = filteredMock.filter((v: any) => v.noiseLevel === "quiet");
    if (filters.ergonomic) filteredMock = filteredMock.filter((v: any) => v.hasErgonomic);
    if (filters.outletDensity && filters.outletDensity !== "none") {
      if (filters.outletDensity === "every_table") {
        filteredMock = filteredMock.filter((v: any) => v.outletDensity === "every_table");
      } else if (filters.outletDensity === "some_tables") {
        filteredMock = filteredMock.filter((v: any) => ["every_table", "some_tables"].includes(v.outletDensity));
      } else if (filters.outletDensity === "wall_seats") {
        filteredMock = filteredMock.filter((v: any) => ["every_table", "some_tables", "wall_seats"].includes(v.outletDensity));
      }
    }
    if (filters.wifiSpeedBand && filters.wifiSpeedBand !== "all") {
      if (filters.wifiSpeedBand === "basic") {
        filteredMock = filteredMock.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 10);
      } else if (filters.wifiSpeedBand === "fast") {
        filteredMock = filteredMock.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 50);
      } else if (filters.wifiSpeedBand === "ultra") {
        filteredMock = filteredMock.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 100);
      }
    }
  }

  return {
    venues: filteredMock,
    meta: { total: filteredMock.length, source: "Simulation Fallback", highTraffic: overpassFailed },
    reasoning: `Returned ${filteredMock.length} simulated fallback venues due to Overpass API offline status`,
  };
}

// ============================================================
// DB ENRICHMENT — joins Prisma VenueRating data onto OSM venues
// ============================================================

interface RawVenue {
  id: string;
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
}

async function enrichVenuesWithDBRatings(venues: RawVenue[]): Promise<RawVenue[]> {
  if (venues.length === 0) return venues;

  try {
    // Look up any stored ratings by placeId (OSM id stored as placeId)
    const placeIds = venues.map((v) => v.id);
    const dbVenues = await prisma.venue.findMany({
      where: { placeId: { in: placeIds } },
      include: { ratings: true },
    });

    // Build a lookup map: placeId → aggregated crowdsourced data
    const dbMap = new Map<
      string,
      {
        avgWifi: number | null;
        outletPct: number;
        noiseMode: string | null;
        hasErgonomic: boolean;
        outletDensity: string | null;
        wifiSpeed: number | null;
      }
    >();

    for (const dbV of dbVenues) {
      const ratings = dbV.ratings;
      if (ratings.length === 0) {
        // No user ratings — use the stored venue-level values if present
        dbMap.set(dbV.placeId, {
          avgWifi: dbV.wifiQuality ? dbV.wifiQuality * 2 : null, // convert 1-5 → 2-10
          outletPct: dbV.hasOutlets ? 100 : 0,
          noiseMode: dbV.noiseLevel ?? null,
          hasErgonomic: dbV.hasErgonomic,
          outletDensity: dbV.outletDensity ?? null,
          wifiSpeed: dbV.wifiSpeed ?? null,
        });
      } else {
        // Aggregate user ratings
        const avgWifi =
          ratings.reduce((sum, r) => sum + r.wifiQuality, 0) / ratings.length;
        const outletPct =
          (ratings.filter((r) => r.hasOutlets).length / ratings.length) * 100;
        const ergonomicPct =
          (ratings.filter((r) => r.hasErgonomic).length / ratings.length) * 100;

        const validSpeeds = ratings.filter((r) => r.wifiSpeed !== null && r.wifiSpeed > 0).map((r) => r.wifiSpeed as number);
        const avgSpeed = validSpeeds.length > 0 ? Math.round(validSpeeds.reduce((sum, s) => sum + s, 0) / validSpeeds.length) : null;

        const densityCounts: Record<string, number> = {};
        for (const r of ratings) {
          if (r.outletDensity) {
            densityCounts[r.outletDensity] = (densityCounts[r.outletDensity] || 0) + 1;
          }
        }
        const outletDensityMode = Object.keys(densityCounts).length > 0
          ? Object.entries(densityCounts).reduce((best, [lvl, cnt]) => cnt > (densityCounts[best] ?? 0) ? lvl : best, "none")
          : "none";

        // Mode of noiseLevel
        const noiseCounts: Record<string, number> = {};
        for (const r of ratings) {
          noiseCounts[r.noiseLevel] = (noiseCounts[r.noiseLevel] || 0) + 1;
        }
        const noiseMode = Object.entries(noiseCounts).reduce(
          (best, [level, count]) =>
            count > (noiseCounts[best] ?? 0) ? level : best,
          "moderate"
        );

        dbMap.set(dbV.placeId, {
          avgWifi: (avgWifi / 5) * 10, // convert 1-5 scale → 0-10
          outletPct,
          noiseMode,
          hasErgonomic: ergonomicPct >= 50,
          outletDensity: outletDensityMode,
          wifiSpeed: avgSpeed,
        });
      }
    }

    // Merge DB data back onto OSM venues
    return venues.map((venue) => {
      const db = dbMap.get(venue.id);
      if (!db) return venue; // No DB record → keep OSM data as-is

      return {
        ...venue,
        // Override wifi only if we have richer information
        wifi: venue.wifi || (db.avgWifi !== null && db.avgWifi >= 5),
        hasOutlets: db.outletPct >= 50,
        noiseLevel: db.noiseMode ?? venue.noiseLevel,
        wifiQuality: db.avgWifi,
        hasErgonomic: db.hasErgonomic,
        outletDensity: db.outletDensity ?? venue.outletDensity,
        wifiSpeed: db.wifiSpeed ?? venue.wifiSpeed,
      };
    });
  } catch (err) {
    console.error("[Enrichment] DB lookup failed, using OSM-only data:", err);
    return venues;
  }
}

// ============================================================
// AGENT 4: REASONING - Scores and ranks venues
// Uses enriched DB data (wifiQuality 0-10, outletPct, noiseMode)
// ============================================================
function reasoningAgent(
  venues: RawVenue[],
  preferences: { workType?: string; amenities?: string[] }
): {
  rankedVenues: Array<RawVenue & { score: number; scoreBreakdown: Record<string, number> }>;
  summary: string;
  reasoning: string;
} {
  const { workType = "focus", amenities = [] } = preferences;

  const weights: Record<string, { wifi: number; noise: number; outlets: number; rating: number }> = {
    focus: { wifi: 0.25, noise: 0.35, outlets: 0.25, rating: 0.15 },
    calls: { wifi: 0.40, noise: 0.30, outlets: 0.15, rating: 0.15 },
    collaboration: { wifi: 0.30, noise: 0.20, outlets: 0.25, rating: 0.25 },
    casual: { wifi: 0.25, noise: 0.25, outlets: 0.25, rating: 0.25 },
  };

  const w = weights[workType] || weights.focus;

  const scoredVenues = venues.map((venue) => {
    // WiFi: use crowdsourced wifiQuality (0-10) if available, else boolean tag
    const wifiScore =
      venue.wifiQuality != null
        ? Math.min(10, venue.wifiQuality)   // crowdsourced 0-10
        : venue.wifi
          ? 7                                  // OSM wlan tag present
          : 3;                                 // unknown

    // Noise: crowdsourced mode from DB, or OSM tag
    const noiseScore =
      venue.noiseLevel === "quiet" ? 9 :
        venue.noiseLevel === "moderate" ? 6 : 3;

    // Outlets: crowdsourced boolean (outletPct >= 50%) or OSM
    const outletsScore = venue.hasOutlets ? 8 : 4;

    // Rating: from OSM/DB avg
    const ratingScore = venue.rating != null ? Math.min(10, venue.rating * 2) : 5;

    // Extra bonus for explicitly-requested features
    let amenityBonus = 0;
    const safeAmenities = amenities || [];
    if (safeAmenities.includes("wifi") && wifiScore >= 6) amenityBonus += 1;
    if (safeAmenities.includes("quiet") && venue.noiseLevel === "quiet") amenityBonus += 1;
    if (safeAmenities.includes("outlets") && venue.hasOutlets) amenityBonus += 1;

    const totalScore =
      wifiScore * w.wifi +
      noiseScore * w.noise +
      outletsScore * w.outlets +
      ratingScore * w.rating +
      amenityBonus;

    return {
      ...venue,
      score: Math.min(10, Math.round(totalScore * 10) / 10),
      scoreBreakdown: { wifi: wifiScore, noise: noiseScore, outlets: outletsScore, rating: ratingScore },
    };
  });

  scoredVenues.sort((a, b) => b.score - a.score);

  const topVenue = scoredVenues[0];
  const summary = topVenue
    ? `Top pick: ${topVenue.name} (score: ${topVenue.score}/10)`
    : "No venues found";

  return {
    rankedVenues: scoredVenues,
    summary,
    reasoning: `Scored ${scoredVenues.length} venues using "${workType}" weights (WiFi ${Math.round(w.wifi * 100)}%, Noise ${Math.round(w.noise * 100)}%, Outlets ${Math.round(w.outlets * 100)}%). DB ratings applied where available.`,
  };
}

// ============================================================
// AGENT 5: ACTION - Generates final response and map updates
// ============================================================
async function actionAgent(
  rankedVenues: any[],
  _userQuery: string
): Promise<{
  message: string;
  mapUpdates: any;
  suggestions: string[];
}> {
  const venueList = rankedVenues.slice(0, 5).map((v, i) =>
    `${i + 1}. **${v.name}** (${v.category}) - Score: ${v.score}/10${v.wifi ? " 📶" : ""}${v.hasOutlets ? " 🔌" : ""}`
  ).join("\n");

  const message = rankedVenues.length > 0
    ? `I found ${rankedVenues.length} great workspaces near you!\n\n${venueList}\n\nThe markers are now on your map. Click any venue for more details.`
    : "I couldn't find any workspaces matching your criteria. Try expanding your search radius or adjusting your filters.";

  const markers = rankedVenues.slice(0, 10).map((v) => ({
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

  let center = { lat: 0, lng: 0 };
  if (rankedVenues.length > 0) {
    center = {
      lat: rankedVenues.reduce((sum, v) => sum + v.lat, 0) / rankedVenues.length,
      lng: rankedVenues.reduce((sum, v) => sum + v.lng, 0) / rankedVenues.length,
    };
  }

  return {
    message,
    mapUpdates: { markers, view: { center, zoom: 14, animate: true } },
    suggestions: [
      "Show me only cafes",
      "Find places with better WiFi",
      "Get directions to the top pick",
      "Show quieter options",
    ],
  };
}

// ============================================================
// MAIN API HANDLER
// ============================================================
export async function POST(req: Request) {
  try {
    // Rate limiting - get IP or user ID
    const { userId } = await auth();
    const forwarded = req.headers.get("x-forwarded-for");
    const identifier = userId || forwarded?.split(",")[0] || "anonymous";

    // Rate limiting (now async)
    if (!(await rateLimit(identifier, 20))) {
      const info = getRateLimitInfo(identifier);
      return Response.json(
        {
          error: "Rate limit exceeded. Please wait before sending more messages.",
          retryAfter: info?.resetTime ? Math.ceil((info.resetTime - Date.now()) / 1000) : 60
        },
        { status: 429 }
      );
    }

    const body = await req.json();

    // Validate request with Zod
    const validation = validateRequest(chatRequestSchema, body);
    if (!validation.success) {
      console.error("Chat validation error:", validation.error);
      return Response.json({ error: validation.error }, { status: 400 });
    }

    const { messages, location, conversationId } = validation.data;
    const { filters } = body; // filters is optional, not in schema

    // Normalize location - use null if not valid
    const validLocation = location && typeof location.lat === 'number' && typeof location.lng === 'number' ? location : null;

    console.log("Chat request:", { messagesCount: messages?.length, location: validLocation, filters });

    const userMessage = messages[messages.length - 1]?.content || "";
    const agentSteps: any[] = [];

    // ====== STEP 1: ORCHESTRATOR ======
    console.log("Running Orchestrator Agent...");
    const orchStart = Date.now();
    const orchestratorResult = await orchestratorAgent(userMessage, { location: validLocation });
    agentSteps.push({
      agent: "Orchestrator",
      result: orchestratorResult,
      timestamp: Date.now(),
      latencyMs: Date.now() - orchStart,
    });

    // If general conversation, respond directly
    if (orchestratorResult.skipAgents) {
      const responseStream = await getGroqClient().chat.completions.create({
        model: "llama-3.3-70b-versatile",
        stream: true,
        messages: [
          {
            role: "system",
            content: "You are WorkHub AI, a friendly assistant for finding workspaces. Be helpful and conversational. When appropriate to show data, output <ui-component name=\"DataTable\" props='{\"columns\": [...], \"data\": [...]}' /> or <ui-component name=\"Map\" props='{\"markers\": [...]}' />.",
          },
          ...messages.map((m: any) => ({ 
            role: m.role, 
            content: m.name ? `[User: ${m.name}] ${m.content}` : m.content 
          })),
        ],
      });

      const stream = new ReadableStream({
        async start(controller) {
          const metadata = {
            venues: [],
            agentSteps,
            cached: false,
            suggestions: [],
            complexity: orchestratorResult.complexity,
          };
          controller.enqueue(new TextEncoder().encode(`METADATA:${JSON.stringify(metadata)}\n\n`));

          let fullContent = "";
          try {
            for await (const chunk of responseStream) {
              const text = chunk.choices[0]?.delta?.content || "";
              if (text) {
                fullContent += text;
                controller.enqueue(new TextEncoder().encode(`TEXT:${text}`));
              }
            }
          } catch(e) {
            console.error("Stream error:", e);
          }
          
          if (userId && conversationId) {
            try {
              await prisma.message.create({
                data: { conversationId, role: "user", content: userMessage },
              });
              await prisma.message.create({
                data: { conversationId, role: "assistant", content: fullContent, agentName: "GeneralChat" },
              });
              await prisma.conversation.update({
                where: { id: conversationId },
                data: { updatedAt: new Date() },
              });

              // Trigger background preference learning & summary updates
              extractAndStoreMemories(conversationId)
                .then(() => updateUserPreferencesSummary(userId))
                .catch((err) => console.error("[GeneralChat] Background preference sync failed:", err));
            } catch (dbError) {
              console.error("Database save error:", dbError);
            }
          }
          
          controller.close();
        }
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
    }

    // ====== CACHE & ROUTING ======
    let contextResult: any = null;
    let dataResult: any = null;
    let enrichedVenues: any[] = [];
    let reasoningResult: any = null;
    let isCached = false;

    if (orchestratorResult.complexity === "complex") {
      // Try semantic cache
      console.log("Checking Semantic Cache...");
      const cachedResponse = await checkSemanticCache(userMessage, validLocation ? `${validLocation.lat},${validLocation.lng}` : null);

      if (cachedResponse) {
        console.log("Semantic Cache Hit!");
        isCached = true;
        reasoningResult = cachedResponse;

        agentSteps.push({
          agent: "Context",
          result: { skipped: true, reason: "Cache hit" },
          timestamp: Date.now(),
          latencyMs: 1,
        });

        agentSteps.push({
          agent: "Data",
          result: { skipped: true, reason: "Cache hit" },
          timestamp: Date.now(),
          latencyMs: 1,
        });

        agentSteps.push({
          agent: "Reasoning",
          result: {
            summary: "Served from cache",
            reasoning: "Matched a highly similar recent query",
            topVenues: reasoningResult.rankedVenues.slice(0, 3).map((v: any) => ({
              name: v.name,
              score: v.score,
            })),
          },
          timestamp: Date.now(),
          latencyMs: 50,
        });
      }
    }

    if (!isCached) {
      if (orchestratorResult.complexity === "simple" && orchestratorResult.parameters) {
        console.log("Bypassing Context Agent for Simple query...");
        contextResult = { parameters: orchestratorResult.parameters };
        agentSteps.push({
          agent: "Context",
          result: { skipped: true, parameters: contextResult.parameters },
          timestamp: Date.now(),
          latencyMs: 10,
        });
      } else {
        // ====== STEP 2: CONTEXT AGENT ======
        console.log("Running Context Agent...");
        const contextStart = Date.now();
        contextResult = await contextAgent(userMessage, validLocation ?? undefined, userId);
        agentSteps.push({
          agent: "Context",
          result: contextResult,
          timestamp: Date.now(),
          latencyMs: Date.now() - contextStart,
        });
      }

      // ====== STEP 3: DATA AGENT ======
      console.log("Running Data Agent...");
      const dataStart = Date.now();
      dataResult = await dataAgent(contextResult.parameters, filters);
      agentSteps.push({
        agent: "Data",
        result: {
          venueCount: dataResult.venues.length,
          meta: dataResult.meta,
          reasoning: dataResult.reasoning,
        },
        timestamp: Date.now(),
        latencyMs: Date.now() - dataStart,
      });

      // ====== STEP 3b: DB ENRICHMENT ======
      console.log("Enriching venues with DB ratings...");
      enrichedVenues = await enrichVenuesWithDBRatings(dataResult.venues as RawVenue[]);

      // Apply advanced filters post-DB enrichment
      let finalFilteredVenues = enrichedVenues;
      if (filters) {
        if (filters.wifi) finalFilteredVenues = finalFilteredVenues.filter((v: any) => v.wifi);
        if (filters.outlets) finalFilteredVenues = finalFilteredVenues.filter((v: any) => v.hasOutlets);
        if (filters.quiet) finalFilteredVenues = finalFilteredVenues.filter((v: any) => v.noiseLevel === "quiet");
        if (filters.ergonomic) finalFilteredVenues = finalFilteredVenues.filter((v: any) => v.hasErgonomic);
        if (filters.outletDensity && filters.outletDensity !== "none") {
          if (filters.outletDensity === "every_table") {
            finalFilteredVenues = finalFilteredVenues.filter((v: any) => v.outletDensity === "every_table");
          } else if (filters.outletDensity === "some_tables") {
            finalFilteredVenues = finalFilteredVenues.filter((v: any) => ["every_table", "some_tables"].includes(v.outletDensity));
          } else if (filters.outletDensity === "wall_seats") {
            finalFilteredVenues = finalFilteredVenues.filter((v: any) => ["every_table", "some_tables", "wall_seats"].includes(v.outletDensity));
          }
        }
        if (filters.wifiSpeedBand && filters.wifiSpeedBand !== "all") {
          if (filters.wifiSpeedBand === "basic") {
            finalFilteredVenues = finalFilteredVenues.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 10);
          } else if (filters.wifiSpeedBand === "fast") {
            finalFilteredVenues = finalFilteredVenues.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 50);
          } else if (filters.wifiSpeedBand === "ultra") {
            finalFilteredVenues = finalFilteredVenues.filter((v: any) => v.wifiSpeed !== null && v.wifiSpeed >= 100);
          }
        }
      }

      if (orchestratorResult.complexity === "simple") {
        console.log("Bypassing Reasoning Agent for Simple query...");
        reasoningResult = {
          summary: "Here are some basic matches.",
          reasoning: "Simple query routing",
          rankedVenues: finalFilteredVenues.map(v => ({ ...v, score: 50, pros: [], cons: [], aiSummary: "Matches basic criteria" }))
        };
        agentSteps.push({
          agent: "Reasoning",
          result: { skipped: true },
          timestamp: Date.now(),
          latencyMs: 10,
        });
      } else {
        // ====== STEP 4: REASONING AGENT ======
        console.log("Running Reasoning Agent...");
        const reasoningStart = Date.now();
        reasoningResult = reasoningAgent(finalFilteredVenues, {
          workType: contextResult.parameters.workType,
          amenities: contextResult.parameters.amenities,
        });
        agentSteps.push({
          agent: "Reasoning",
          result: {
            summary: reasoningResult.summary,
            reasoning: reasoningResult.reasoning,
            topVenues: reasoningResult.rankedVenues.slice(0, 3).map((v: any) => ({
              name: v.name,
              score: v.score,
            })),
          },
          timestamp: Date.now(),
          latencyMs: Date.now() - reasoningStart,
        });

        // Save to cache
        await setSemanticCache(userMessage, validLocation ? `${validLocation.lat},${validLocation.lng}` : null, reasoningResult);
      }
    }

    // ====== STEP 5: ACTION AGENT ======
    console.log("Running Action Agent...");
    const actionStart = Date.now();
    const actionResult = await actionAgent(reasoningResult.rankedVenues, userMessage);
    agentSteps.push({
      agent: "Action",
      result: {
        markerCount: actionResult.mapUpdates.markers.length,
        suggestions: actionResult.suggestions,
      },
      timestamp: Date.now(),
      latencyMs: Date.now() - actionStart,
    });

    // ====== GENERATE STREAM RESPONSE ======
    const groq = getGroqClient();
    const systemPrompt = `You are WorkHub AI, a helpful workspace assistant. 
You can use Generative UI. When you need to show a map, use:
<ui-component name="Map" props='{"markers": [{"lat": ..., "lng": ..., "name": "...", "category": "..."}]}' />
When you need to show a table, use:
<ui-component name="DataTable" props='{"columns": ["Name", "Category", "Score"], "data": [{"Name": "...", "Category": "...", "Score": "..."}]}' />
Here are the top venues found: ${JSON.stringify(reasoningResult.rankedVenues.map((v:any)=>({name: v.name, category: v.category, lat: v.lat, lng: v.lng, score: v.score})))}
Address the user's query and include UI components if helpful.`;

    const llmMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: any) => ({ 
        role: m.role, 
        content: m.name ? `[User: ${m.name}] ${m.content}` : m.content 
      })),
    ];

    const responseStream = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      stream: true,
      messages: llmMessages as any,
    });

    const stream = new ReadableStream({
      async start(controller) {
        const metadata = {
          venues: reasoningResult.rankedVenues,
          mapUpdates: actionResult.mapUpdates,
          suggestions: actionResult.suggestions,
          agentSteps,
          cached: isCached,
          complexity: orchestratorResult.complexity,
          highTraffic: dataResult?.meta?.highTraffic || false,
        };
        controller.enqueue(new TextEncoder().encode(`METADATA:${JSON.stringify(metadata)}\n\n`));

        let fullContent = "";
        try {
          for await (const chunk of responseStream) {
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) {
              fullContent += text;
              controller.enqueue(new TextEncoder().encode(`TEXT:${text}`));
            }
          }
        } catch(e) {
          console.error("Stream error", e);
        }
        
        if (userId && conversationId) {
          try {
            await prisma.message.create({
              data: { conversationId, role: "user", content: userMessage },
            });
            await prisma.message.create({
              data: { conversationId, role: "assistant", content: fullContent, agentName: "ActionAgent" },
            });
            await prisma.conversation.update({
              where: { id: conversationId },
              data: { updatedAt: new Date() },
            });

            // Trigger background preference learning & summary updates
            extractAndStoreMemories(conversationId)
              .then(() => updateUserPreferencesSummary(userId))
              .catch((err) => console.error("[ActionAgent] Background preference sync failed:", err));
          } catch (dbError) {
            console.error("Database save error:", dbError);
          }
        }
        
        controller.close();
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "An error occurred" },
      { status: 500 }
    );
  }
}
