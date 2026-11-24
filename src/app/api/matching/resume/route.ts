/**
 * route.ts
 * Real resume text extraction, Groq LLM structured parsing, 1024-dimensional skill embedding,
 * and progressive streaming semantic resume skill similarity ranker with cosine scoring (SSE).
 */

import { NextResponse } from "next/server";
import { ResumeParser, ParsedResume } from "@/core/ai/ResumeParser";
import {
  SkillEmbedder,
  TARGET_EMBEDDING_DIMENSION,
  extractSharedSkillHighlights,
  similarityToMatchPercentage,
} from "@/core/ai/SkillEmbedder";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function extractTextFromBuffer(
  buffer: ArrayBuffer | ArrayBufferView,
  filename: string,
  mimeType: string,
): string {
  const lowerName = filename.toLowerCase();
  const isAllowedExt =
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".text") ||
    lowerName.endsWith(".md");
  const isTextMime =
    mimeType.startsWith("text/") || mimeType === "application/json";

  if (!isAllowedExt && !isTextMime) {
    throw new Error(
      `Unsupported file format: ${filename}. Supported formats are text files (.txt, .md, text/plain).`,
    );
  }

  const raw = Buffer.from(
    buffer instanceof ArrayBuffer ? buffer : buffer.buffer,
    buffer instanceof ArrayBuffer ? 0 : buffer.byteOffset,
    buffer.byteLength,
  ).toString("utf-8");

  // Reject files containing binary null bytes
  if (raw.includes("\0")) {
    throw new Error("Uploaded file appears to be a binary or corrupted file.");
  }

  const trimmed = raw.trim();
  if (trimmed.length < 50) {
    throw new Error(
      "Extracted resume content is too short (minimum 50 characters required).",
    );
  }

  return trimmed;
}

export interface CandidateResult {
  candidateId: string;
  rank: number;
  matchPercentage: number;
  sharedSkills: string[];
}

export type SSEResumeEvent =
  | { type: "start"; requestId: string; totalCandidates: number }
  | ({ type: "candidate" } & CandidateResult)
  | { type: "progress"; processed: number; total: number }
  | { type: "complete"; processed: number; returned: number }
  | { type: "error"; code: string; message: string };

function formatSSE(event: SSEResumeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function computeNormalizedCompositeVector(vectors: number[][]): number[] {
  const composite = new Array(TARGET_EMBEDDING_DIMENSION).fill(0);
  if (!vectors.length) return composite;

  for (const vec of vectors) {
    for (let i = 0; i < TARGET_EMBEDDING_DIMENSION; i++) {
      composite[i] += vec[i];
    }
  }
  for (let i = 0; i < TARGET_EMBEDDING_DIMENSION; i++) {
    composite[i] /= vectors.length;
  }

  // L2 Normalize
  let norm = 0;
  for (let i = 0; i < TARGET_EMBEDDING_DIMENSION; i++) {
    norm += composite[i] * composite[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < TARGET_EMBEDDING_DIMENSION; i++) {
      composite[i] /= norm;
    }
  }
  return composite;
}

export async function POST(request: Request) {
  try {
    let extractedText = "";
    const contentType = request.headers.get("content-type") || "";
    const acceptsStream = request.headers.get("accept")?.includes("text/event-stream");

    if (
      contentType.includes("multipart/form-data") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      const formData = await request.formData();
      const file = formData.get("resume") as File;

      if (!file) {
        return NextResponse.json(
          { error: "No resume file provided." },
          { status: 400 },
        );
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: "File exceeds maximum size limit of 5MB." },
          { status: 400 },
        );
      }

      const buffer = await file.arrayBuffer();
      if (buffer.byteLength === 0) {
        return NextResponse.json(
          { error: "Uploaded resume file is empty." },
          { status: 400 },
        );
      }

      try {
        extractedText = extractTextFromBuffer(
          buffer,
          file.name || "resume.txt",
          file.type || "text/plain",
        );
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      if (!body?.resumeText) {
        return NextResponse.json(
          { error: "No resume file provided." },
          { status: 400 },
        );
      }
      if (
        typeof body.resumeText !== "string" ||
        body.resumeText.trim().length === 0
      ) {
        return NextResponse.json(
          { error: "Uploaded resume file is empty." },
          { status: 400 },
        );
      }
      if (body.resumeText.length > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: "File exceeds maximum size limit of 5MB." },
          { status: 400 },
        );
      }
      if (body.resumeText.includes("\0")) {
        return NextResponse.json(
          { error: "Uploaded file appears to be a binary or corrupted file." },
          { status: 400 },
        );
      }
      if (body.resumeText.trim().length < 50) {
        return NextResponse.json(
          {
            error:
              "Extracted resume content is too short (minimum 50 characters required).",
          },
          { status: 400 },
        );
      }
      extractedText = body.resumeText.trim();
    } else {
      return NextResponse.json(
        { error: "No resume file provided." },
        { status: 400 },
      );
    }

    // 2. Parse extracted text using Groq
    let parser: ResumeParser;
    try {
      parser = new ResumeParser();
    } catch (configErr: any) {
      return NextResponse.json({ error: configErr.message }, { status: 503 });
    }

    let parsedResume: ParsedResume;
    try {
      parsedResume = await parser.parse(extractedText);
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Failed to parse resume text." },
        { status: 400 },
      );
    }

    // 3. Generate real 1024-dimensional embeddings for extracted skills
    let embedder: SkillEmbedder;
    try {
      embedder = new SkillEmbedder();
    } catch (configErr: any) {
      return NextResponse.json({ error: configErr.message }, { status: 503 });
    }

    let skillEmbeddings: Array<{ skill: string; vector: number[] }> = [];
    try {
      skillEmbeddings = await embedder.embedSkills(parsedResume.skills);
    } catch (embedErr: any) {
      return NextResponse.json(
        { error: embedErr?.message || "Failed to generate skill embeddings." },
        { status: 500 },
      );
    }

    // If client requested SSE stream, execute progressive ranking stream
    if (acceptsStream) {
      return handleStreamingCandidateMatch({
        request,
        parsedResume,
        skillEmbeddings,
        embedder,
      });
    }

    // Default REST behavior (backward-compatible)
    let matchedVenues: Array<{
      id: string;
      name: string;
      matchScore: number;
      address?: string;
    }> = [];

    if (skillEmbeddings.length > 0) {
      const queryVector = computeNormalizedCompositeVector(
        skillEmbeddings.map((item) => item.vector),
      );
      const embeddingString = `[${queryVector.join(",")}]`;

      const venues = await prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          address: string | null;
          similarity: number;
        }>
      >`
        SELECT
          v."id",
          v."name",
          v."address",
          1 - (v."searchEmbedding" <=> ${embeddingString}::vector) AS similarity
        FROM "Venue" v
        WHERE v."searchEmbedding" IS NOT NULL
        ORDER BY v."searchEmbedding" <=> ${embeddingString}::vector ASC
        LIMIT 5;
      `;

      matchedVenues = venues.map((v) => ({
        id: v.id,
        name: v.name,
        matchScore: Number(Number(v.similarity).toFixed(2)),
        address: v.address || undefined,
      }));
    }

    return NextResponse.json(
      {
        success: true,
        parsedResume,
        skillEmbeddingsCount: skillEmbeddings.length,
        matchedVenues,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Resume matching API error:", error?.message || error);
    return NextResponse.json(
      {
        error: "Internal server error during resume processing.",
      },
      { status: 500 },
    );
  }
}

/**
 * Progressive streaming semantic candidate similarity ranker using Server-Sent Events (SSE).
 */
export async function handleStreamingCandidateMatch({
  request,
  parsedResume,
  skillEmbeddings,
  embedder: _embedder,
  candidateLimit = 20,
  batchSize = 5,
}: {
  request: Request;
  parsedResume: ParsedResume;
  skillEmbeddings: Array<{ skill: string; vector: number[] }>;
  embedder?: SkillEmbedder;
  candidateLimit?: number;
  batchSize?: number;
}): Promise<Response> {
  const requestId = crypto.randomUUID();
  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      const safeEnqueue = (event: SSEResumeEvent) => {
        if (isClosed || signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(formatSSE(event)));
        } catch {
          isClosed = true;
        }
      };

      const closeStream = () => {
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      };

      if (signal.aborted) {
        closeStream();
        return;
      }

      signal.addEventListener("abort", () => {
        isClosed = true;
        try {
          controller.close();
        } catch {
          // Ignore
        }
      });

      try {
        if (!skillEmbeddings || skillEmbeddings.length === 0) {
          safeEnqueue({ type: "start", requestId, totalCandidates: 0 });
          safeEnqueue({ type: "complete", processed: 0, returned: 0 });
          closeStream();
          return;
        }

        const queryVector = computeNormalizedCompositeVector(
          skillEmbeddings.map((item) => item.vector),
        );
        const embeddingString = `[${queryVector.join(",")}]`;

        // 1. Fetch count of candidate records with embeddings
        let totalCount = 0;
        try {
          const countResult = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
            SELECT COUNT(*)::int AS count
            FROM "Venue" v
            WHERE v."searchEmbedding" IS NOT NULL;
          `;
          totalCount = Number(countResult[0]?.count ?? 0);
        } catch (dbErr: any) {
          console.error("Failed to query candidate count:", dbErr);
          safeEnqueue({
            type: "error",
            code: "DATABASE_ERROR",
            message: "Failed to initialize candidate similarity search.",
          });
          closeStream();
          return;
        }

        const effectiveTotal = Math.min(totalCount, candidateLimit);
        safeEnqueue({
          type: "start",
          requestId,
          totalCandidates: effectiveTotal,
        });

        if (effectiveTotal === 0) {
          safeEnqueue({ type: "complete", processed: 0, returned: 0 });
          closeStream();
          return;
        }

        // 2. Fetch and stream candidates progressively in bounded batches ordered by cosine similarity
        let processedCount = 0;
        let returnedCount = 0;
        let rank = 1;
        let offset = 0;

        while (offset < effectiveTotal && !isClosed && !signal.aborted) {
          const currentBatchLimit = Math.min(batchSize, effectiveTotal - offset);

          const batch = await prisma.$queryRaw<
            Array<{
              id: string;
              name: string;
              similarity: number;
              tags?: string[] | null;
            }>
          >`
            SELECT
              v."id",
              v."name",
              1 - (v."searchEmbedding" <=> ${embeddingString}::vector) AS similarity
            FROM "Venue" v
            WHERE v."searchEmbedding" IS NOT NULL
            ORDER BY v."searchEmbedding" <=> ${embeddingString}::vector ASC
            LIMIT ${currentBatchLimit}
            OFFSET ${offset};
          `;

          if (!batch || batch.length === 0) {
            break;
          }

          for (const item of batch) {
            if (isClosed || signal.aborted) break;

            const matchPercentage = similarityToMatchPercentage(Number(item.similarity));
            const candidateSkills = Array.isArray(item.tags) ? item.tags : [];
            const sharedSkills = extractSharedSkillHighlights(
              parsedResume.skills,
              candidateSkills,
            );

            safeEnqueue({
              type: "candidate",
              rank,
              candidateId: item.id,
              matchPercentage,
              sharedSkills,
            });

            rank++;
            returnedCount++;
          }

          processedCount += batch.length;
          offset += batch.length;

          safeEnqueue({
            type: "progress",
            processed: processedCount,
            total: effectiveTotal,
          });
        }

        if (!isClosed && !signal.aborted) {
          safeEnqueue({
            type: "complete",
            processed: processedCount,
            returned: returnedCount,
          });
        }
      } catch (err: any) {
        console.error("Streaming error during candidate ranking:", err);
        safeEnqueue({
          type: "error",
          code: "MATCHING_FAILED",
          message: "Unable to complete candidate matching.",
        });
      } finally {
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
