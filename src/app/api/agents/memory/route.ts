/**
 * route.ts
 * API endpoint to trigger memory consolidation and query the knowledge graph.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GraphMemory, GraphNode, GraphEdge } from '@/core/agents/memory/GraphMemory';
import { EmbeddingIndex, VectorDocument } from '@/core/agents/memory/EmbeddingIndex';
import { PromptAssembler, PromptContext } from '@/core/agents/memory/PromptAssembler';

// In-memory instances for demonstration. In production, these would be backed by Redis/Postgres.
const globalGraphMemory = new GraphMemory();
const globalEmbeddingIndex = new EmbeddingIndex();
const promptAssembler = new PromptAssembler(globalGraphMemory, globalEmbeddingIndex);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, payload } = body;

    if (action === 'ADD_NODE') {
      const node = payload as GraphNode;
      globalGraphMemory.addNode(node);
      return NextResponse.json({ success: true, message: 'Node added' }, { status: 200 });
    }

    if (action === 'ADD_EDGE') {
      const edge = payload as GraphEdge;
      globalGraphMemory.addEdge(edge);
      return NextResponse.json({ success: true, message: 'Edge added' }, { status: 200 });
    }

    if (action === 'ADD_DOCUMENT') {
      const doc = payload as VectorDocument;
      globalEmbeddingIndex.addDocument(doc);
      return NextResponse.json({ success: true, message: 'Document indexed' }, { status: 200 });
    }

    if (action === 'GENERATE_PROMPT') {
      const context = payload as PromptContext;
      const prompt = await promptAssembler.assembleSystemPrompt(context);
      return NextResponse.json({ success: true, prompt }, { status: 200 });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Memory API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
