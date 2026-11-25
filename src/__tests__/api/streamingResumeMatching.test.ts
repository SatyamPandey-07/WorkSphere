import {
  POST,
  handleStreamingCandidateMatch,
  SSEResumeEvent,
} from "@/app/api/matching/resume/route";
import { ResumeParser } from "@/core/ai/ResumeParser";
import {
  SkillEmbedder,
  TARGET_EMBEDDING_DIMENSION,
  normalizeSkill,
  extractSharedSkillHighlights,
  similarityToMatchPercentage,
} from "@/core/ai/SkillEmbedder";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

jest.mock("@/core/ai/ResumeParser");
jest.mock("@/core/ai/SkillEmbedder", () => {
  const actual = jest.requireActual("@/core/ai/SkillEmbedder");
  const MockSkillEmbedder = jest.fn().mockImplementation(() => ({
    embedSkills: jest.fn(),
    calculateCosineSimilarity: actual.SkillEmbedder.prototype.calculateCosineSimilarity,
  }));
  (MockSkillEmbedder as any).clearCache = actual.SkillEmbedder.clearCache;
  (MockSkillEmbedder as any).prototype = actual.SkillEmbedder.prototype;
  return {
    ...actual,
    SkillEmbedder: MockSkillEmbedder,
  };
});

async function parseSSEEvents(response: Response): Promise<SSEResumeEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let buffer = "";
  const events: SSEResumeEvent[] = [];

  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (result.value) {
      buffer += decoder.decode(result.value, { stream: !done });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (line) {
          events.push(JSON.parse(line.slice(6)));
        }
      }
    }
  }

  return events;
}

describe("Issue #9619 - Streaming Semantic Resume Skill Similarity Ranker with Cosine Scoring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SkillEmbedder.clearCache();
    ResumeParser.clearCache();
  });

  describe("Cosine Similarity and Scoring Helpers", () => {
    let embedder: SkillEmbedder;

    beforeEach(() => {
      // Mock embedding constructor with dummy key
      embedder = new (SkillEmbedder as any)();
      embedder.calculateCosineSimilarity =
        SkillEmbedder.prototype.calculateCosineSimilarity;
    });

    it("calculates exact 1.0 for identical vectors", () => {
      const v = [0.6, 0.8];
      const sim = embedder.calculateCosineSimilarity(v, v);
      expect(sim).toBeCloseTo(1.0, 5);
      expect(similarityToMatchPercentage(sim)).toBe(100);
    });

    it("calculates 0.0 for orthogonal vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      const sim = embedder.calculateCosineSimilarity(v1, v2);
      expect(sim).toBe(0);
      expect(similarityToMatchPercentage(sim)).toBe(0);
    });

    it("calculates -1.0 for opposite vectors and clamps match percentage to 0", () => {
      const v1 = [1, 0];
      const v2 = [-1, 0];
      const sim = embedder.calculateCosineSimilarity(v1, v2);
      expect(sim).toBeCloseTo(-1.0, 5);
      expect(similarityToMatchPercentage(sim)).toBe(0);
    });

    it("returns 0.0 safely for zero-length vectors or zero magnitudes", () => {
      expect(embedder.calculateCosineSimilarity([], [])).toBe(0);
      expect(embedder.calculateCosineSimilarity([0, 0], [0, 0])).toBe(0);
      expect(embedder.calculateCosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it("returns 0.0 safely for non-finite values", () => {
      expect(embedder.calculateCosineSimilarity([NaN, 1], [1, 1])).toBe(0);
      expect(embedder.calculateCosineSimilarity([Infinity, 1], [1, 1])).toBe(0);
    });

    it("throws error for dimension mismatches", () => {
      expect(() =>
        embedder.calculateCosineSimilarity([1, 2], [1, 2, 3]),
      ).toThrow("Vectors must be of the same dimension.");
    });
  });

  describe("Shared Skill Extraction and Normalization", () => {
    it("normalizes skills consistently (whitespace, hyphens, lowercase)", () => {
      expect(normalizeSkill(" TypeScript ")).toBe("typescript");
      expect(normalizeSkill("Node-JS")).toBe("nodejs");
      expect(normalizeSkill("Next_js")).toBe("nextjs");
      expect(normalizeSkill("C++")).toBe("c++");
      expect(normalizeSkill("")).toBe("");
    });

    it("extracts exact and case-insensitive shared skills cleanly without duplicates", () => {
      const resumeSkills = ["TypeScript", "React", "PostgreSQL", "Docker"];
      const candidateSkills = [
        "react",
        "typescript",
        "Node.js",
        "PostgreSQL",
        "REACT",
      ];

      const shared = extractSharedSkillHighlights(resumeSkills, candidateSkills);
      expect(shared).toEqual(["React", "TypeScript", "PostgreSQL"]);
    });

    it("bounds output highlights to maxHighlights", () => {
      const resumeSkills = ["A", "B", "C", "D", "E"];
      const candidateSkills = ["a", "b", "c", "d", "e"];
      const shared = extractSharedSkillHighlights(resumeSkills, candidateSkills, 3);
      expect(shared).toHaveLength(3);
      expect(shared).toEqual(["A", "B", "C"]);
    });

    it("returns empty array when candidate or resume skills are empty or missing", () => {
      expect(extractSharedSkillHighlights([], ["TypeScript"])).toEqual([]);
      expect(extractSharedSkillHighlights(["React"], [])).toEqual([]);
      expect(extractSharedSkillHighlights(null as any, undefined as any)).toEqual(
        [],
      );
    });
  });

  describe("SSE Streaming Candidate Matching Endpoint", () => {
    const resumeText =
      "Alice Chen\nSenior Full Stack Developer\n8 years building resilient microservices using TypeScript, Node.js, React, and PostgreSQL.";

    it("returns Content-Type text/event-stream with required cache and buffering headers", async () => {
      (ResumeParser as jest.Mock).mockImplementation(() => ({
        parse: jest.fn().mockResolvedValue({
          fullName: "Alice Chen",
          skills: ["TypeScript", "React"],
        }),
      }));

      (SkillEmbedder as jest.Mock).mockImplementation(() => ({
        embedSkills: jest.fn().mockResolvedValue([
          {
            skill: "TypeScript",
            vector: new Array(TARGET_EMBEDDING_DIMENSION).fill(0.1),
          },
        ]),
        calculateCosineSimilarity:
          SkillEmbedder.prototype.calculateCosineSimilarity,
      }));

      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ count: 2 }]) // count query
        .mockResolvedValueOnce([
          // batch 1
          { id: "cand-1", name: "Candidate 1", similarity: 0.94 },
          { id: "cand-2", name: "Candidate 2", similarity: 0.88 },
        ]);

      const req = new Request("http://localhost:3000/api/matching/resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ resumeText }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
      expect(res.headers.get("Connection")).toBe("keep-alive");
      expect(res.headers.get("X-Accel-Buffering")).toBe("no");

      const events = await parseSSEEvents(res);
      expect(events.length).toBeGreaterThanOrEqual(4);

      // Verify sequence: start -> candidate 1 -> candidate 2 -> progress -> complete
      expect(events[0]).toMatchObject({
        type: "start",
        totalCandidates: 2,
      });

      const candidateEvents = events.filter((e) => e.type === "candidate");
      expect(candidateEvents).toHaveLength(2);
      expect(candidateEvents[0]).toMatchObject({
        type: "candidate",
        rank: 1,
        candidateId: "cand-1",
        matchPercentage: 94,
      });
      expect(candidateEvents[1]).toMatchObject({
        type: "candidate",
        rank: 2,
        candidateId: "cand-2",
        matchPercentage: 88,
      });

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toMatchObject({
        type: "complete",
        processed: 2,
        returned: 2,
      });
    });

    it("streams multiple bounded batches progressively and preserves ranking", async () => {
      const mockVector = new Array(TARGET_EMBEDDING_DIMENSION).fill(0.05);

      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ count: 4 }])
        .mockResolvedValueOnce([
          { id: "cand-10", name: "Ten", similarity: 0.96 },
          { id: "cand-20", name: "Twenty", similarity: 0.91 },
        ])
        .mockResolvedValueOnce([
          { id: "cand-30", name: "Thirty", similarity: 0.84 },
          { id: "cand-40", name: "Forty", similarity: 0.77 },
        ]);

      const req = new Request("http://localhost:3000/api/matching/resume", {
        method: "POST",
      });

      const embedder = new (SkillEmbedder as any)();
      embedder.calculateCosineSimilarity =
        SkillEmbedder.prototype.calculateCosineSimilarity;

      const res = await handleStreamingCandidateMatch({
        request: req,
        parsedResume: {
          fullName: "Test",
          email: "test@example.com",
          skills: ["TypeScript"],
          industries: [],
          seniorityLevel: "Senior",
          yearsOfExperience: 5,
          summary: "",
        },
        skillEmbeddings: [{ skill: "TypeScript", vector: mockVector }],
        embedder,
        candidateLimit: 4,
        batchSize: 2,
      });

      const events = await parseSSEEvents(res);
      const candidates = events.filter((e) => e.type === "candidate");
      expect(candidates).toHaveLength(4);
      expect(candidates.map((c: any) => c.rank)).toEqual([1, 2, 3, 4]);
      expect(candidates.map((c: any) => c.candidateId)).toEqual([
        "cand-10",
        "cand-20",
        "cand-30",
        "cand-40",
      ]);
      expect(candidates.map((c: any) => c.matchPercentage)).toEqual([
        96, 91, 84, 77,
      ]);
    });

    it("handles empty candidate sets cleanly with start and complete events", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ count: 0 }]);

      const req = new Request("http://localhost:3000/api/matching/resume");
      const embedder = new (SkillEmbedder as any)();

      const res = await handleStreamingCandidateMatch({
        request: req,
        parsedResume: {
          fullName: "Test",
          email: "test@example.com",
          skills: ["TypeScript"],
          industries: [],
          seniorityLevel: "Senior",
          yearsOfExperience: 5,
          summary: "",
        },
        skillEmbeddings: [
          {
            skill: "TypeScript",
            vector: new Array(TARGET_EMBEDDING_DIMENSION).fill(0.1),
          },
        ],
        embedder,
      });

      const events = await parseSSEEvents(res);
      expect(events).toEqual([
        expect.objectContaining({ type: "start", totalCandidates: 0 }),
        expect.objectContaining({ type: "complete", processed: 0, returned: 0 }),
      ]);
    });

    it("handles client cancellation gracefully via AbortSignal", async () => {
      const abortController = new AbortController();
      const req = new Request("http://localhost:3000/api/matching/resume", {
        signal: abortController.signal,
      });

      (prisma.$queryRaw as jest.Mock).mockImplementation(async () => {
        abortController.abort();
        return [{ count: 10 }];
      });

      const embedder = new (SkillEmbedder as any)();
      const res = await handleStreamingCandidateMatch({
        request: req,
        parsedResume: {
          fullName: "Test",
          email: "test@example.com",
          skills: ["TypeScript"],
          industries: [],
          seniorityLevel: "Senior",
          yearsOfExperience: 5,
          summary: "",
        },
        skillEmbeddings: [
          {
            skill: "TypeScript",
            vector: new Array(TARGET_EMBEDDING_DIMENSION).fill(0.1),
          },
        ],
        embedder,
      });

      const events = await parseSSEEvents(res);
      // Aborted before processing can proceed
      expect(events.length).toBeLessThanOrEqual(1);
    });

    it("emits error event when database query fails", async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(
        new Error("Connection reset"),
      );

      const req = new Request("http://localhost:3000/api/matching/resume");
      const embedder = new (SkillEmbedder as any)();

      const res = await handleStreamingCandidateMatch({
        request: req,
        parsedResume: {
          fullName: "Test",
          email: "test@example.com",
          skills: ["TypeScript"],
          industries: [],
          seniorityLevel: "Senior",
          yearsOfExperience: 5,
          summary: "",
        },
        skillEmbeddings: [
          {
            skill: "TypeScript",
            vector: new Array(TARGET_EMBEDDING_DIMENSION).fill(0.1),
          },
        ],
        embedder,
      });

      const events = await parseSSEEvents(res);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "error",
          code: "DATABASE_ERROR",
        }),
      );
    });
  });
});
