/**
 * IcebreakerGenerator
 * Formats the users' shared interests and professional backgrounds into structured 
 * Groq prompts to generate natural, localized conversation starters.
 */

import { MatchEdge } from '../matchmaking/LanguageExchangeGraph';

export interface IcebreakerContext {
  userAName: string;
  userBName: string;
  userAProfession: string;
  userBProfession: string;
  edge: MatchEdge;
  venueContext: string; // e.g., "Starbucks Downtown", "WeWork Main St"
}

export interface GeneratedIcebreaker {
  promptA: string; // What A should say to B in B's native language
  promptB: string; // What B should say to A in A's native language
  topicSuggestion: string;
  languageTip: string;
}

export class IcebreakerGenerator {
  private apiKey: string;
  private model: string;
  private cache: Map<string, { result: GeneratedIcebreaker; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(apiKey: string, model: string = 'llama3-70b-8192') {
    this.apiKey = apiKey;
    this.model = model;
  }

  public async generate(context: IcebreakerContext): Promise<GeneratedIcebreaker> {
    const cacheKey = this.getCacheKey(context);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.result;
    }

    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(context);

    try {
      const response = await this.callGroqAPI(systemPrompt, userPrompt);
      const parsed = this.parseResponse(response);
      
      this.cache.set(cacheKey, { result: parsed, timestamp: Date.now() });
      return parsed;
    } catch (error) {
      console.error('Icebreaker generation failed:', error);
      return this.getFallbackIcebreaker(context);
    }
  }

  private buildSystemPrompt(ctx: IcebreakerContext): string {
    return `You are an expert language coach and social facilitator. 
Your goal is to generate natural, non-awkward icebreakers for two people meeting at a ${ctx.venueContext}.
User A (${ctx.userAName}, ${ctx.userAProfession}) is learning ${ctx.edge.sharedLanguageB} and speaks native ${ctx.edge.sharedLanguageA}.
User B (${ctx.userBName}, ${ctx.userBProfession}) is learning ${ctx.edge.sharedLanguageA} and speaks native ${ctx.edge.sharedLanguageB}.
They share these interests: ${ctx.edge.commonInterests.join(', ')}.

Rules:
1. Keep prompts under 2 sentences.
2. Prompt A must be written in ${ctx.edge.sharedLanguageB} (B's native language) so A can practice reading/speaking it.
3. Prompt B must be written in ${ctx.edge.sharedLanguageA} (A's native language) so B can practice reading/speaking it.
4. Include a specific language tip for the exchange.
5. Output MUST be valid JSON.`;
  }

  private buildUserPrompt(ctx: IcebreakerContext): string {
    return `Generate the icebreaker JSON for ${ctx.userAName} and ${ctx.userBName} based on their shared interest in ${ctx.edge.commonInterests[0] || 'general networking'}.`;
  }

  private async callGroqAPI(system: string, user: string): Promise<string> {
    // In production, this uses the actual Groq SDK or fetch
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) throw new Error('Groq API request failed');
    const data = await response.json();
    return data.choices[0].message.content;
  }

  private parseResponse(raw: string): GeneratedIcebreaker {
    const parsed = JSON.parse(raw);
    return {
      promptA: parsed.promptA || "Hello!",
      promptB: parsed.promptB || "Hi!",
      topicSuggestion: parsed.topicSuggestion || "Ask about their work",
      languageTip: parsed.languageTip || "Speak slowly and clearly"
    };
  }

  private getFallbackIcebreaker(ctx: IcebreakerContext): GeneratedIcebreaker {
    return {
      promptA: `Hi ${ctx.userBName}, I see we both like ${ctx.edge.commonInterests[0] || 'tech'}. Want to practice ${ctx.edge.sharedLanguageB}?`,
      promptB: `Hi ${ctx.userAName}, I'd love to practice ${ctx.edge.sharedLanguageA} with you. What do you do?`,
      topicSuggestion: ctx.edge.commonInterests[0] || "Current projects",
      languageTip: "Don't worry about perfect grammar, focus on connection."
    };
  }

  private getCacheKey(ctx: IcebreakerContext): string {
    return `${ctx.edge.userA}-${ctx.edge.userB}-${ctx.edge.sharedLanguageA}-${ctx.edge.sharedLanguageB}`;
  }
}
