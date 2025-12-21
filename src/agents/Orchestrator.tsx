import { generateText } from "ai";
import { google } from "@ai-sdk/google";

/**
 * Orchestrator Agent
 * Determines which agents are needed for each user request
 * Routes work-space related queries through the agent pipeline
 */

const systemPrompt = `You are the Orchestrator Agent for WorkHub, a workspace finder application.

Your role is to analyze user messages and determine which specialized agents are needed to fulfill the request.

Available agents:
- ContextAgent: Understands user intent and extracts search parameters (workType, amenities, location, etc.)
- DataAgent: Fetches venue data from external APIs and databases
- ReasoningAgent: Scores and ranks venues based on work-friendliness criteria
- ActionAgent: Updates the map UI and generates user-facing responses

Decision rules:
1. If the message is about finding/searching workspaces → Use all 4 agents (Context → Data → Reasoning → Action)
2. If asking about specific venue details → Use DataAgent + ActionAgent
3. If asking for directions to known venue → Use ActionAgent only
4. If general conversation/greeting → Use NO agents (respond directly)
5. If asking about previous results → Use ReasoningAgent + ActionAgent

Output format (JSON):
{
  "agentsToUse": ["ContextAgent", "DataAgent", "ReasoningAgent", "ActionAgent"],
  "reasoning": "User wants to find quiet cafes, need full pipeline",
  "skipAgents": false
}

For general chat, return: { "skipAgents": true, "reasoning": "General conversation, no workspace search needed" }`;

export async function orchestratorAgent(userMessage: string, context?: any) {
  try {
    const { text } = await generateText({
      model: google("gemini-2.0-flash-exp"),
      system: systemPrompt,
      prompt: `User message: "${userMessage}"
      
Previous context: ${context ? JSON.stringify(context) : "None"}

Analyze this message and determine which agents to use.`,
      temperature: 0.3,
    });

    // Parse the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return result;
    }

    // Fallback: assume full pipeline needed
    return {
      agentsToUse: ["ContextAgent", "DataAgent", "ReasoningAgent", "ActionAgent"],
      reasoning: "Unable to parse orchestrator response, using full pipeline",
      skipAgents: false,
    };
  } catch (error) {
    console.error("Orchestrator agent error:", error);
    return {
      agentsToUse: ["ContextAgent", "DataAgent", "ReasoningAgent", "ActionAgent"],
      reasoning: "Error in orchestrator, defaulting to full pipeline",
      skipAgents: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
