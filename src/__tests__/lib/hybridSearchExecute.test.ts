import {
  MAX_HYBRID_SEARCH_LIMIT,
  VENUE_EMBEDDING_DIMENSIONS,
  executeHybridSearch,
  isUsableVenueEmbedding,
} from "@/lib/search/hybridSearch";

let mockEmbedding: number[] = [];

jest.mock("@/lib/ai/gemini", () => ({
  isGeminiConfigured: () => true,
  getGeminiClient: () => ({
    models: {
      embedContent: async () => ({ embeddings: [{ values: mockEmbedding }] }),
    },
  }),
}));

jest.mock("@/lib/redis", () => ({ getRedis: () => null }));

function unitVector(dimensions = VENUE_EMBEDDING_DIMENSIONS): number[] {
  const values = new Array(dimensions).fill(0);
  values[0] = 1;
  return values;
}

function clientReturning(rows: unknown[]) {
  return { $queryRawUnsafe: jest.fn().mockResolvedValue(rows) };
}

describe("isUsableVenueEmbedding", () => {
  it("accepts a non-zero embedding of the column's dimension", () => {
    expect(isUsableVenueEmbedding(unitVector())).toBe(true);
  });

  it.each([
    ["a 768-value embedding", unitVector(768)],
    ["an all-zero embedding", new Array(VENUE_EMBEDDING_DIMENSIONS).fill(0)],
    ["an empty embedding", []],
    ["a non-finite value", [...unitVector().slice(1), Number.NaN]],
    ["something that is not an array", "[1,0,0]"],
  ])("rejects %s", (_case, embedding) => {
    expect(isUsableVenueEmbedding(embedding)).toBe(false);
  });
});

describe("executeHybridSearch (#7879)", () => {
  beforeEach(() => {
    mockEmbedding = unitVector();
  });

  it("queries the columns the Venue table has", async () => {
    const client = clientReturning([]);

    await executeHybridSearch("quiet cafe", client);

    const sql: string = client.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('"searchEmbedding"');
    expect(sql).toContain('"searchVector"');
    expect(sql).toContain('venue."address"');
    expect(sql).not.toMatch(/\bsearch_vector\b/);
    expect(sql).not.toMatch(/\bdescription\b/);
    expect(sql).not.toMatch(/[^"A-Za-z]embedding\b/);
  });

  it("passes the embedding as a parameter, not inside the SQL text", async () => {
    const client = clientReturning([]);

    await executeHybridSearch("quiet cafe", client, 5, 30);

    const [sql, query, rrfK, limit, vector] =
      client.$queryRawUnsafe.mock.calls[0];
    expect(query).toBe("quiet cafe");
    expect(rrfK).toBe(30);
    expect(limit).toBe(5);
    expect(vector).toBe(`[${unitVector().join(",")}]`);
    expect(sql).toContain("$4::vector");
    expect(sql).not.toContain("[1,0");
  });

  it.each([
    ["has the wrong dimension", unitVector(768)],
    ["is all zeros", new Array(VENUE_EMBEDDING_DIMENSIONS).fill(0)],
  ])(
    "sends NULL for the vector when the embedding %s",
    async (_case, embedding) => {
      mockEmbedding = embedding;
      const client = clientReturning([]);

      await executeHybridSearch(`quiet cafe ${embedding.length}`, client);

      expect(client.$queryRawUnsafe.mock.calls[0][4]).toBeNull();
    },
  );

  it("clamps the limit and the RRF constant to safe integers", async () => {
    const client = clientReturning([]);

    await executeHybridSearch("clamp high", client, 5000, 0);
    await executeHybridSearch("clamp low", client, -3, Number.NaN);
    await executeHybridSearch("clamp fraction", client, 7.9, 12.6);

    const params = client.$queryRawUnsafe.mock.calls.map(
      ([, , rrfK, limit]: unknown[]) => [rrfK, limit],
    );
    expect(params).toEqual([
      [1, MAX_HYBRID_SEARCH_LIMIT],
      [60, 1],
      [12, 7],
    ]);
  });

  it("returns rows with a numeric score", async () => {
    const client = clientReturning([
      {
        id: "v1",
        name: "Quiet Corner Cafe",
        address: "1 Main St",
        category: "cafe",
        score: "0.0325",
      },
    ]);

    await expect(executeHybridSearch("numeric score", client)).resolves.toEqual(
      [
        {
          id: "v1",
          name: "Quiet Corner Cafe",
          address: "1 Main St",
          category: "cafe",
          score: 0.0325,
        },
      ],
    );
  });

  it("returns an empty list when the query yields nothing", async () => {
    const client = { $queryRawUnsafe: jest.fn().mockResolvedValue(null) };
    await expect(executeHybridSearch("nothing", client)).resolves.toEqual([]);
  });
});
