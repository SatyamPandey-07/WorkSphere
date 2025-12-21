import { generateText } from "ai";
import { google } from "@ai-sdk/google";

/**
 * Context Agent
 * Understands user intent and extracts structured parameters
 * Converts natural language to search criteria
 */

const systemPrompt = `You are the Context Agent for WorkHub, a workspace finder application.

Your role is to understand user intent and extract structured search parameters from natural language queries.

Extract these parameters:
1. workType: "focus" | "calls" | "collaboration" | "casual"
   - "focus" = quiet space for deep work
   - "calls" = space for video/phone calls
   - "collaboration" = group work space
   - "casual" = relaxed work environment

2. amenities: array of required features
   - "wifi" = good WiFi required
   - "outlets" = power outlets needed
   - "quiet" = low noise level
   - "parking" = parking available
   - "outdoor" = outdoor seating

3. location: { lat, lng } or address string
   - Extract from "near [place]" or "in [area]"
   - "near me" = use user's current location

4. radius: number (meters)
   - "nearby" = 1000m
   - "close" = 2000m
   - "within X miles/km" = convert to meters

5. category: ["cafe", "coworking", "library"] or specific type

6. timeOfDay: "morning" | "afternoon" | "evening" | null

7. duration: estimated time needed (minutes)

Output format (JSON):
{
  "intent": "Find quiet workspace with outlets",
  "parameters": {
    "workType": "focus",
    "amenities": ["wifi", "outlets", "quiet"],
    "location": "near me",
    "radius": 2000,
    "category": ["cafe", "coworking"],
    "timeOfDay": null,
    "duration": 120
  },
  "required_data": ["venues", "crowdsourced_ratings"],
  "reasoning": "User needs focus work space, prioritizing quiet environment with reliable power"
}

Be flexible with language. Examples:
- "quiet cafe with outlets" → workType: "focus", amenities: ["quiet", "outlets"]
- "place for a meeting" → workType: "collaboration"
- "somewhere to take calls" → workType: "calls"
- "coworking space" → category: ["coworking"]`;

export async function contextAgent(userMessage: string, userLocation?: { lat: number; lng: number }) {
  try {
    const { text } = await generateText({
      model: google("gemini-2.0-flash-exp"),
      system: systemPrompt,
      prompt: `User message: "${userMessage}"
${userLocation ? `User's current location: ${userLocation.lat}, ${userLocation.lng}` : "User location: unknown"}

Extract search parameters and intent.`,
      temperature: 0.4,
    });

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      
      // If location is "near me" and we have user location, replace it
      if (result.parameters.location === "near me" && userLocation) {
        result.parameters.location = userLocation;
      }
      
      return result;
    }

    // Fallback
    return {
      intent: userMessage,
      parameters: {
        workType: "focus",
        amenities: ["wifi"],
        location: userLocation || "near me",
        radius: 2000,
        category: ["cafe", "coworking", "library"],
      },
      required_data: ["venues"],
      reasoning: "Unable to parse context, using default parameters",
    };
  } catch (error) {
    console.error("Context agent error:", error);
    return {
      intent: userMessage,
      parameters: {
        workType: "focus",
        amenities: ["wifi"],
        location: userLocation || "near me",
        radius: 2000,
        category: ["cafe", "coworking", "library"],
      },
      required_data: ["venues"],
      reasoning: "Error in context agent",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
