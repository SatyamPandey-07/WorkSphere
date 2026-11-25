import { POST, extractTextFromBuffer } from "@/app/api/matching/resume/route";
import { ResumeParser } from "@/core/ai/ResumeParser";
import {
  SkillEmbedder,
  TARGET_EMBEDDING_DIMENSION,
} from "@/core/ai/SkillEmbedder";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

jest.mock("@/core/ai/ResumeParser");
jest.mock("@/core/ai/SkillEmbedder");

describe("Issue #9518 - Real Resume Extraction & Semantic Vector Matching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("extractTextFromBuffer", () => {
    it("extracts text cleanly from valid text and markdown files", () => {
      const text =
        "Senior Full Stack Engineer with 7 years of production experience in TypeScript, React, Next.js, and PostgreSQL.";
      const uint8 = new TextEncoder().encode(text);

      const extracted = extractTextFromBuffer(
        uint8,
        "resume.txt",
        "text/plain",
      );
      expect(extracted).toBe(text);
    });

    it("rejects unsupported binary formats", () => {
      const uint8 = new TextEncoder().encode("random binary content");
      expect(() =>
        extractTextFromBuffer(uint8, "resume.exe", "application/octet-stream"),
      ).toThrow("Unsupported file format");
    });

    it("rejects files containing corrupt or binary null bytes", () => {
      const uint8 = new TextEncoder().encode(
        "Corrupted resume with \0 null byte",
      );
      expect(() =>
        extractTextFromBuffer(uint8, "resume.txt", "text/plain"),
      ).toThrow("Uploaded file appears to be a binary or corrupted file.");
    });

    it("rejects content that is too short (< 50 characters)", () => {
      const uint8 = new TextEncoder().encode("Too short");
      expect(() =>
        extractTextFromBuffer(uint8, "resume.txt", "text/plain"),
      ).toThrow("Extracted resume content is too short");
    });
  });

  describe("POST /api/matching/resume", () => {
    it("returns 400 when no resume content is provided", async () => {
      const req = new Request("http://localhost:3000/api/matching/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("No resume file provided.");
    });

    it("returns 400 when uploaded resume text is empty", async () => {
      const req = new Request("http://localhost:3000/api/matching/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: "   " }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("empty");
    });

    it("returns 503 when Groq API key is not configured", async () => {
      (ResumeParser as jest.Mock).mockImplementation(() => {
        throw new Error("GROQ_API_KEY is not configured.");
      });

      const text =
        "Jane Doe\nPrincipal Architect with 10+ years in distributed systems, Rust, Kubernetes, and Go.";
      const req = new Request("http://localhost:3000/api/matching/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
      });

      const res = await POST(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toContain("GROQ_API_KEY is not configured");
    });

    it("returns 503 when embedding provider is not configured", async () => {
      (ResumeParser as jest.Mock).mockImplementation(() => ({
        parse: jest.fn().mockResolvedValue({
          fullName: "Jane Doe",
          skills: ["Rust", "Kubernetes"],
        }),
      }));

      (SkillEmbedder as jest.Mock).mockImplementation(() => {
        throw new Error("Embedding provider API key is not configured.");
      });

      const text =
        "Jane Doe\nPrincipal Architect with 10+ years in distributed systems, Rust, Kubernetes, and Go.";
      const req = new Request("http://localhost:3000/api/matching/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
      });

      const res = await POST(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toContain(
        "Embedding provider API key is not configured",
      );
    });

    it("extracts text, generates 1024-dim embeddings, queries pgvector, and returns real ranked matches", async () => {
      (ResumeParser as jest.Mock).mockImplementation(() => ({
        parse: jest.fn().mockResolvedValue({
          fullName: "Alex Rivera",
          email: "alex@example.com",
          skills: ["TypeScript", "Next.js", "PostgreSQL"],
          industries: ["SaaS", "FinTech"],
          seniorityLevel: "Senior",
          yearsOfExperience: 6,
          summary: "Senior software engineer focused on cloud infrastructure.",
        }),
      }));

      const mockVector1024 = new Array(TARGET_EMBEDDING_DIMENSION).fill(0.05);

      (SkillEmbedder as jest.Mock).mockImplementation(() => ({
        embedSkills: jest.fn().mockResolvedValue([
          { skill: "TypeScript", vector: mockVector1024 },
          { skill: "Next.js", vector: mockVector1024 },
          { skill: "PostgreSQL", vector: mockVector1024 },
        ]),
      }));

      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          id: "v-001",
          name: "Silicon Hub Cowork",
          address: "100 Market St",
          similarity: 0.88,
        },
        {
          id: "v-002",
          name: "Founders Lounge",
          address: "250 Mission St",
          similarity: 0.74,
        },
      ]);

      const text =
        "Alex Rivera\nSenior Software Engineer\n6 years building distributed cloud applications using TypeScript, Next.js, and PostgreSQL.";
      const req = new Request("http://localhost:3000/api/matching/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.parsedResume.fullName).toBe("Alex Rivera");
      expect(json.skillEmbeddingsCount).toBe(3);
      expect(json.matchedVenues).toHaveLength(2);
      expect(json.matchedVenues[0].name).toBe("Silicon Hub Cowork");
      expect(json.matchedVenues[0].matchScore).toBe(0.88);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("returns empty matchedVenues array when no venue embeddings exist without fabricating scores", async () => {
      (ResumeParser as jest.Mock).mockImplementation(() => ({
        parse: jest.fn().mockResolvedValue({
          fullName: "Dev User",
          skills: ["Python"],
        }),
      }));

      (SkillEmbedder as jest.Mock).mockImplementation(() => ({
        embedSkills: jest.fn().mockResolvedValue([
          {
            skill: "Python",
            vector: new Array(TARGET_EMBEDDING_DIMENSION).fill(0.01),
          },
        ]),
      }));

      // Database has no venues with searchEmbedding populated
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const text =
        "Dev User\nPython Data Scientist with experience in pandas, NumPy, and machine learning pipelines.";
      const req = new Request("http://localhost:3000/api/matching/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.matchedVenues).toEqual([]);
    });
  });
});
