import { prisma } from "@/lib/prisma";
import Groq from "groq-sdk";
import { applyFilters } from "@/lib/filters";

// Lazy init Groq client
let groq: Groq | null = null;
function getGroqClient(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  if (!groq) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY || "",
      maxRetries: 2,
      timeout: 20000,
    });
  }
  return groq;
}

export interface RawVenue {
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
  hasPhoneBooths: boolean;
  hasNoMusic: boolean;
  hasQuietZone: boolean;
  hasAncHeadsetRental: boolean;
}

// AGENT 1: ORCHESTRATOR
export async function orchestratorAgent(
  userMessage: string,
  context?: any,
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
        {
          role: "user",
          content: `User message: "${userMessage}"\nContext: ${context ? JSON.stringify(context) : "None"}\nNote: This is a multiplayer session.`,
        },
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

// AGENT 2: CONTEXT
export async function contextAgent(
  userMessage: string,
  userLocation?: { lat: number; lng: number },
  userId?: string | null,
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
    teamSize?: number;
  };
  reasoning: string;
}> {
  const systemPrompt = `Extract search parameters from the user's message.
Output ONLY valid JSON:
{
  "intent": "find_workspaces",
  "parameters": {
    "workType": "focus | calls | meeting | casual",
    "amenities": ["wifi", "outlets", "quiet", "ergonomic"],
    "location": null,
    "radius": 2000,
    "category": ["cafe", "coworking", "library"]
  },
  "reasoning": "Extracted intent and params"
}`;

  try {
    const response = await getGroqClient().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Message: "${userMessage}"\nLocation: ${userLocation ? `${userLocation.lat}, ${userLocation.lng}` : "unknown"}`,
        },
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
    console.error("ContextAgent error:", error);
  }

  return {
    intent: "find_workspaces",
    parameters: {
      workType: "focus",
      amenities: ["wifi"],
      location: userLocation || null,
      radius: 2000,
      category: ["cafe", "coworking", "library"],
    },
    reasoning: "Default parameters",
  };
}

// AGENT 3: DATA
export async function dataAgent(
  params: any,
  filters?: any,
): Promise<{
  venues: RawVenue[];
  meta: { total: number; source: string; highTraffic?: boolean };
  reasoning: string;
}> {
  const location = params.location || { lat: 37.7749, lng: -122.4194 };
  const mockVenues: RawVenue[] = [
    {
      id: "mock-1",
      name: "Central Library Workspace",
      lat: location.lat + 0.002,
      lng: location.lng - 0.001,
      category: "library",
      address: "123 Main Street",
      wifi: true,
      hasOutlets: true,
      noiseLevel: "quiet",
      rating: 4.8,
      wifiQuality: 5,
      openingHours: "08:00-22:00",
      hasErgonomic: true,
      outletDensity: "every_table",
      wifiSpeed: 150,
      hasPhoneBooths: true,
      hasNoMusic: true,
      hasQuietZone: true,
      hasAncHeadsetRental: true,
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
      wifiSpeed: 80,
      hasPhoneBooths: false,
      hasNoMusic: false,
      hasQuietZone: false,
      hasAncHeadsetRental: false,
    },
  ];

  const filtered = applyFilters(mockVenues as any, filters || {});
  return {
    venues: filtered as any,
    meta: { total: filtered.length, source: "mock" },
    reasoning: `Found ${filtered.length} matching venues`,
  };
}

// AGENT 4: REASONING
export function reasoningAgent(
  venues: RawVenue[],
  preferences: { workType?: string; amenities?: string[] },
): {
  rankedVenues: Array<
    RawVenue & { score: number; scoreBreakdown: Record<string, number> }
  >;
  summary: string;
  reasoning: string;
} {
  const ranked = venues.map((v) => {
    let score = (v.rating || 3.5) * 2;
    if (v.wifi) score += 1;
    if (v.hasOutlets) score += 1;
    score = Math.min(10, Math.round(score * 10) / 10);
    return {
      ...v,
      score,
      scoreBreakdown: { rating: v.rating || 3.5, wifi: v.wifi ? 1 : 0 },
    };
  });

  ranked.sort((a, b) => b.score - a.score);

  return {
    rankedVenues: ranked,
    summary: `Ranked ${ranked.length} venues based on preferences`,
    reasoning: "Sorted by combined rating and amenities score",
  };
}

// AGENT 5: ACTION
export async function actionAgent(
  rankedVenues: any[],
  _userQuery: string,
): Promise<{
  message: string;
  mapUpdates: any;
  suggestions: string[];
}> {
  const venueList = rankedVenues
    .slice(0, 5)
    .map(
      (v, i) =>
        `${i + 1}. **${v.name}** (${v.category}) - Score: ${v.score}/10${v.wifi ? " 📶" : ""}${v.hasOutlets ? " 🔌" : ""}`,
    )
    .join("\n");

  const message =
    rankedVenues.length > 0
      ? `I found ${rankedVenues.length} great workspaces near you!\n\n${venueList}\n\nThe markers are now on your map.`
      : "I couldn't find any workspaces matching your criteria.";

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

  return {
    message,
    mapUpdates: {
      center: markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : { lat: 0, lng: 0 },
      zoom: 14,
      markers,
    },
    suggestions: [
      "Find cafes with fast Wi-Fi",
      "Show quiet places with power outlets",
      "Filter by top rating",
    ],
  };
}
