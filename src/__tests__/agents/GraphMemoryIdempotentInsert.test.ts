import { GraphMemory, GraphNode } from "@/core/agents/memory/GraphMemory";
import { EmbeddingIndex, VectorDocument } from "@/core/agents/memory/EmbeddingIndex";

describe("GraphMemory - Idempotent Entity Insertion & Concurrency (#5359)", () => {
  let graphMemory: GraphMemory;

  beforeEach(() => {
    graphMemory = new GraphMemory({ pruneIntervalMs: 0 });
  });

  afterEach(() => {
    graphMemory.dispose();
  });

  it("prevents duplicate node insertions when multiple concurrent prompts add the same entity name", async () => {
    const nodeA: GraphNode = {
      id: "venue-task-1",
      type: "VENUE",
      properties: { name: "Sightglass Artisan Coffee & Lab", city: "San Francisco" },
      createdAt: 1000,
    };

    const nodeB: GraphNode = {
      id: "venue-task-2",
      type: "VENUE",
      properties: { name: "Sightglass Artisan Coffee & Lab", rating: 4.8 },
      createdAt: 2000,
    };

    const nodeC: GraphNode = {
      id: "venue-task-3",
      type: "VENUE",
      properties: { name: "sightglass artisan coffee & lab", seating: "Bar" },
      createdAt: 3000,
    };

    // Simulate concurrent invocation from multiple autonomous agent tasks
    await Promise.all([
      (async () => graphMemory.addNode(nodeA))(),
      (async () => graphMemory.addNode(nodeB))(),
      (async () => graphMemory.addNode(nodeC))(),
    ]);

    const exported = graphMemory.exportGraph();
    // Exactly 1 unique node should exist
    expect(exported.nodes).toHaveLength(1);
    expect(exported.nodes[0].properties.name).toBe("Sightglass Artisan Coffee & Lab");
    // Properties should be merged
    expect(exported.nodes[0].properties.city).toBe("San Francisco");
    expect(exported.nodes[0].properties.rating).toBe(4.8);
    expect(exported.nodes[0].properties.seating).toBe("Bar");
  });

  it("resolves edges correctly when referencing aliased node IDs", () => {
    const userNode: GraphNode = {
      id: "user_nomad_42",
      type: "USER",
      properties: { name: "Alex Nomad" },
      createdAt: 1000,
    };

    const venue1: GraphNode = {
      id: "v-initial-1",
      type: "VENUE",
      properties: { name: "Workshop Cafe" },
      createdAt: 1000,
    };

    const venue2Duplicate: GraphNode = {
      id: "v-concurrent-2",
      type: "VENUE",
      properties: { name: "Workshop Cafe" },
      createdAt: 1000,
    };

    graphMemory.addNode(userNode);
    graphMemory.addNode(venue1);
    graphMemory.addNode(venue2Duplicate);

    // Adding edge referencing the aliased duplicate ID
    graphMemory.addEdge({
      sourceId: "user_nomad_42",
      targetId: "v-concurrent-2",
      relationship: "PREFERS",
      weight: 1.0,
      properties: {},
      createdAt: 1000,
    });

    const connected = graphMemory.getConnectedNodes("user_nomad_42", "PREFERS");
    expect(connected).toHaveLength(1);
    expect(connected[0].id).toBe("v-initial-1");
    expect(connected[0].properties.name).toBe("Workshop Cafe");
  });

  it("supports insertion locking with withLock", async () => {
    let executionOrder: number[] = [];

    const task1 = graphMemory.withLock("VENUE:coffee", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      executionOrder.push(1);
    });

    const task2 = graphMemory.withLock("VENUE:coffee", async () => {
      executionOrder.push(2);
    });

    await Promise.all([task1, task2]);
    expect(executionOrder).toEqual([1, 2]);
  });
});

describe("EmbeddingIndex - Idempotent Document Insertion (#5359)", () => {
  let embeddingIndex: EmbeddingIndex;

  beforeEach(() => {
    embeddingIndex = new EmbeddingIndex();
  });

  it("deduplicates documents with identical entityName or text", () => {
    const doc1: VectorDocument = {
      id: "doc-1",
      text: "User prefers quiet acoustic booths with fast wifi",
      embedding: [0.1, 0.2, 0.3],
      metadata: { entityName: "Acoustic Booth" },
    };

    const doc2: VectorDocument = {
      id: "doc-2",
      text: "User prefers quiet acoustic booths with fast wifi",
      embedding: [0.1, 0.2, 0.3],
      metadata: { entityName: "Acoustic Booth", confidence: 0.95 },
    };

    embeddingIndex.addDocument(doc1);
    embeddingIndex.addDocument(doc2);

    const allDocs = embeddingIndex.getAllDocuments();
    expect(allDocs).toHaveLength(1);
    expect(allDocs[0].metadata.confidence).toBe(0.95);
    expect(embeddingIndex.getDocument("doc-2")).toBeDefined();
  });
});
