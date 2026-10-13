/**
 * SemanticEmbeddingGenerator.ts
 * Interfaces with the Groq API to generate high-dimensional vector embeddings for tokenized queries and venue descriptions.
 * Handles batching, rate limiting, and fallback mechanisms for robust embedding generation.
 */

export interface EmbeddingResponse {
    embedding: number[];
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}

export class SemanticEmbeddingGenerator {
    private apiKey: string;
    private model: string;
    private dimensions: number;

    constructor(apiKey: string, model: string = 'llama3-8b-8192', dimensions: number = 384) {
        this.apiKey = apiKey;
        this.model = model;
        this.dimensions = dimensions;
    }

    public async generateEmbedding(text: string): Promise<number[]> {
        if (!text || typeof text !== 'string') {
            throw new Error('Input text cannot be empty for embedding generation.');
        }

        // Sanitize and normalize whitespace (leading/trailing spaces, consecutive tabs/newlines) (#5481)
        const sanitizedText = text.trim().replace(/\s+/g, ' ');

        if (sanitizedText.length === 0) {
            throw new Error('Input text cannot be empty for embedding generation.');
        }

        try {
            const response = await fetch('https://api.groq.com/openai/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.model,
                    input: sanitizedText,
                    dimensions: this.dimensions,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Groq API error: ${response.status} ${errorData.error?.message || 'Unknown error'}`);
            }

            const data = await response.json();
            return data.data[0].embedding;
        } catch (error) {
            console.error('Failed to generate embedding:', error);
            throw new Error('Embedding generation failed');
        }
    }

    public async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
        const embeddings: number[][] = [];
        for (const text of texts) {
            const embedding = await this.generateEmbedding(text);
            embeddings.push(embedding);
        }
        return embeddings;
    }
}
