import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { chatRequestSchema, validateRequest } from "@/lib/validations";

export const maxDuration = 60;

// Lazy init Groq client to avoid build-time errors
let groq: Groq | null = null;
function getGroqClient(): Groq {
  if (!groq) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY || '',
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
}> {
  const systemPrompt = `You are the Orchestrator Agent for WorkHub. Analyze user messages and determine which agents are needed.

Available agents:
- ContextAgent: Extracts search parameters (workType, amenities, location)
- DataAgent: Fetches venue data
- ReasoningAgent: Scores and ranks venues
- ActionAgent: Updates map UI and generates responses

Rules:
1. Finding/searching workspaces → Use all 4 agents
2. Asking about specific venue → DataAgent + ActionAgent
3. Directions to venue → ActionAgent only
4. General conversation → Skip agents

Output ONLY valid JSON:
{"agentsToUse": ["ContextAgent", "DataAgent", "ReasoningAgent", "ActionAgent"], "reasoning": "reason here", "skipAgents": false}

For general chat: {"skipAgents": true, "reasoning": "General conversation"}`;

  try {
    const response = await getGroqClient().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `User message: "${userMessage}"\nContext: ${context ? JSON.stringify(context) : "None"}` },
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
  userLocation?: { lat: number; lng: number }
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
  const systemPrompt = `You are the Context Agent. Extract search parameters from user queries.

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
  filters?: { wifi?: boolean; outlets?: boolean; quiet?: boolean }
): Promise<{
  venues: any[];
  meta: { total: number; source: string };
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

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      if (!response.ok) continue;
      const data = await response.json();

      let venues = data.elements.slice(0, 15).map((el: any) => ({
        id: el.id.toString(),
        name: el.tags?.name || "Unknown Venue",
        lat: el.lat || el.center?.lat,
        lng: el.lon || el.center?.lon,
        category: el.tags?.amenity || "venue",
        address: el.tags?.["addr:street"]
          ? `${el.tags["addr:housenumber"] || ""} ${el.tags["addr:street"]}`.trim()
          : null,
        wifi: el.tags?.internet_access === "wlan" || el.tags?.internet_access === "yes",
        hasOutlets: false,
        noiseLevel: "moderate",
        rating: null,
        wifiQuality: el.tags?.internet_access ? 3 : null,
        openingHours: el.tags?.opening_hours || null,
      }));

      // Apply filters if provided
      if (filters) {
        if (filters.wifi) venues = venues.filter((v: any) => v.wifi);
        if (filters.outlets) venues = venues.filter((v: any) => v.hasOutlets);
        if (filters.quiet) venues = venues.filter((v: any) => v.noiseLevel === "quiet");
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

  return {
    venues: [],
    meta: { total: 0, source: "error" },
    reasoning: "Failed to fetch venues",
  };
}

// ============================================================
// AGENT 4: REASONING - Scores and ranks venues
// ============================================================
function reasoningAgent(
  venues: any[],
  preferences: { workType?: string; amenities?: string[] }
): {
  rankedVenues: any[];
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
    const wifiScore = venue.wifi ? 8 : 4;
    const noiseScore = venue.noiseLevel === "quiet" ? 9 : venue.noiseLevel === "moderate" ? 6 : 3;
    const outletsScore = venue.hasOutlets ? 8 : 4;
    const ratingScore = venue.rating ? venue.rating * 2 : 5;

    let amenityBonus = 0;
    if (amenities.includes("wifi") && venue.wifi) amenityBonus += 1;
    if (amenities.includes("quiet") && venue.noiseLevel === "quiet") amenityBonus += 1;
    if (amenities.includes("outlets") && venue.hasOutlets) amenityBonus += 1;

    const totalScore =
      wifiScore * w.wifi +
      noiseScore * w.noise +
      outletsScore * w.outlets +
      ratingScore * w.rating +
      amenityBonus;

    return {
      ...venue,
      score: Math.round(totalScore * 10) / 10,
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
    reasoning: `Scored ${scoredVenues.length} venues using ${workType} weights. WiFi: ${Math.round(w.wifi * 100)}%, Noise: ${Math.round(w.noise * 100)}%, Outlets: ${Math.round(w.outlets * 100)}%`,
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
    
    // Check rate limit (20 requests per minute for chat)
    if (!rateLimit(identifier, 20)) {
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
    const orchestratorResult = await orchestratorAgent(userMessage, { location: validLocation });
    agentSteps.push({
      agent: "Orchestrator",
      result: orchestratorResult,
      timestamp: Date.now(),
    });

    // If general conversation, respond directly
    if (orchestratorResult.skipAgents) {
      const response = await getGroqClient().chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: "You are WorkHub AI, a friendly assistant for finding workspaces. Be helpful and conversational.",
          },
          ...messages.map((m: any) => ({ role: m.role, content: m.content })),
        ],
      });

      return Response.json({
        content: response.choices[0]?.message?.content || "Hello! How can I help you find a workspace today?",
        agentSteps,
        venues: [],
      });
    }

    // ====== STEP 2: CONTEXT AGENT ======
    console.log("Running Context Agent...");
    const contextResult = await contextAgent(userMessage, validLocation ?? undefined);
    agentSteps.push({
      agent: "Context",
      result: contextResult,
      timestamp: Date.now(),
    });

    // ====== STEP 3: DATA AGENT ======
    console.log("Running Data Agent...");
    const dataResult = await dataAgent(contextResult.parameters, filters);
    agentSteps.push({
      agent: "Data",
      result: { 
        venueCount: dataResult.venues.length,
        meta: dataResult.meta,
        reasoning: dataResult.reasoning,
      },
      timestamp: Date.now(),
    });

    // ====== STEP 4: REASONING AGENT ======
    console.log("Running Reasoning Agent...");
    const reasoningResult = reasoningAgent(dataResult.venues, {
      workType: contextResult.parameters.workType,
      amenities: contextResult.parameters.amenities,
    });
    agentSteps.push({
      agent: "Reasoning",
      result: {
        summary: reasoningResult.summary,
        reasoning: reasoningResult.reasoning,
        topVenues: reasoningResult.rankedVenues.slice(0, 3).map((v) => ({
          name: v.name,
          score: v.score,
        })),
      },
      timestamp: Date.now(),
    });

    // ====== STEP 5: ACTION AGENT ======
    console.log("Running Action Agent...");
    const actionResult = await actionAgent(reasoningResult.rankedVenues, userMessage);
    agentSteps.push({
      agent: "Action",
      result: {
        markerCount: actionResult.mapUpdates.markers.length,
        suggestions: actionResult.suggestions,
      },
      timestamp: Date.now(),
    });

    // ====== SAVE TO DATABASE (if user is authenticated) ======
    try {
      const { userId } = await auth();
      if (userId && conversationId) {
        await prisma.message.create({
          data: { conversationId, role: "user", content: userMessage },
        });
        await prisma.message.create({
          data: { conversationId, role: "assistant", content: actionResult.message, agentName: "ActionAgent" },
        });
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
      }
    } catch (dbError) {
      console.error("Database save error:", dbError);
    }

    return Response.json({
      content: actionResult.message,
      venues: reasoningResult.rankedVenues,
      mapUpdates: actionResult.mapUpdates,
      suggestions: actionResult.suggestions,
      agentSteps,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "An error occurred" },
      { status: 500 }
    );
  }
}
