/**
 * PromptAssembler.ts
 * Dynamically queries the Graph RAG and injects relevant historical context into the Groq system prompts.
 */

import { GraphMemory } from './GraphMemory';
import { EmbeddingIndex } from './EmbeddingIndex';

export interface PromptContext {
  userId: string;
  currentQuery: string;
  queryEmbedding?: number[];
}

export class PromptAssembler {
  private graphMemory: GraphMemory;
  private embeddingIndex: EmbeddingIndex;

  constructor(graphMemory: GraphMemory, embeddingIndex: EmbeddingIndex) {
    this.graphMemory = graphMemory;
    this.embeddingIndex = embeddingIndex;
  }

  public async assembleSystemPrompt(context: PromptContext): Promise<string> {
    const { userId, currentQuery, queryEmbedding } = context;
    
    // 1. Fetch explicit user preferences from Graph
    const preferences = this.graphMemory.getUserPreferences(userId);
    const rejectedVenues = this.graphMemory.getRejectedVenues(userId);
    
    let preferenceText = 'The user has no explicit recorded preferences.';
    if (preferences.length > 0) {
      preferenceText = `The user strongly prefers venues with these features (weights indicate strength): ${preferences.map(p => `Feature ID: ${p.featureId} (Weight: ${p.weight})`).join(', ')}.`;
    }

    let rejectionText = '';
    if (rejectedVenues.length > 0) {
      rejectionText = `DO NOT recommend these previously rejected venue IDs: ${rejectedVenues.join(', ')}.`;
    }

    // 2. Fetch semantically similar past interactions
    let historicalContext = '';
    if (queryEmbedding) {
      const similarDocs = this.embeddingIndex.search(queryEmbedding, 3);
      if (similarDocs.length > 0) {
        historicalContext = `Relevant past interactions or venue details:\n${similarDocs.map(d => `- [Score: ${d.score.toFixed(2)}] ${d.doc.text}`).join('\n')}`;
      }
    }

    // 3. Construct the final prompt
    return `
You are an intelligent workspace discovery agent for WorkSphere. 
Your goal is to recommend the best workspaces based on the user's query, while strictly adhering to their historical preferences and rejections.

### USER PROFILE & HISTORY
${preferenceText}
${rejectionText}

### SEMANTIC CONTEXT
${historicalContext || 'No specific historical semantic matches found.'}

### CURRENT QUERY
"${currentQuery}"

### INSTRUCTIONS
1. Analyze the current query.
2. Cross-reference with the user's explicit preferences and rejections.
3. Use the semantic context to understand nuanced needs (e.g., "quiet like that library I liked last week").
4. Provide a reasoned, context-aware recommendation. Do not recommend rejected venues.
`.trim();
  }
}
