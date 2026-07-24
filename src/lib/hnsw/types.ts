export interface HnswNode {
  id: string;
  vector: number[];
  level: number;
  neighbors: Map<number, string[]>;
}

export interface SearchResult {
  id: string;
  distance: number;
}

export interface HnswConfig {
  dim: number;
  M: number;
  efConstruction: number;
  efSearch: number;
  ml: number;
}

export interface CompressedContext {
  id: string;
  summary: string;
  userId: string;
  conversationId: string;
  embedding: number[];
  tokenCount: number;
  createdAt: number;
  messageCount: number;
}

export interface ContextChunk {
  role: string;
  content: string;
  tokenCount: number;
  embedding?: number[];
}
