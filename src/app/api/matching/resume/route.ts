/**
 * route.ts
 * Real resume text extraction, Groq LLM structured parsing, 1024-dimensional skill embedding,
 * and pgvector semantic venue search pipeline.
 */

import { NextResponse } from "next/server";
import { ResumeParser } from "@/core/ai/ResumeParser";
import {
  SkillEmbedder,
  TARGET_EMBEDDING_DIMENSION,
} from "@/core/ai/SkillEmbedder";
import { prisma } from "@/lib/prisma";

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

export async function POST(request: Request) {
  try {
    let extractedText = "";
    const contentType = request.headers.get("content-type") || "";

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

    const parsedResume = await parser.parse(extractedText);

    // 3. Generate real 1024-dimensional embeddings for extracted skills
    let embedder: SkillEmbedder;
    try {
      embedder = new SkillEmbedder();
    } catch (configErr: any) {
      return NextResponse.json({ error: configErr.message }, { status: 503 });
    }

    const skillEmbeddings = await embedder.embedSkills(parsedResume.skills);

    // 4. Semantic search against pgvector in Venue.searchEmbedding
    let matchedVenues: Array<{
      id: string;
      name: string;
      matchScore: number;
      address?: string;
    }> = [];

    if (skillEmbeddings.length > 0) {
      // Compute composite query vector by averaging skill vectors
      const queryVector = new Array(TARGET_EMBEDDING_DIMENSION).fill(0);
      for (const item of skillEmbeddings) {
        for (let i = 0; i < TARGET_EMBEDDING_DIMENSION; i++) {
          queryVector[i] += item.vector[i];
        }
      }
      for (let i = 0; i < TARGET_EMBEDDING_DIMENSION; i++) {
        queryVector[i] /= skillEmbeddings.length;
      }

      // L2 Normalize
      let norm = 0;
      for (let i = 0; i < TARGET_EMBEDDING_DIMENSION; i++) {
        norm += queryVector[i] * queryVector[i];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < TARGET_EMBEDDING_DIMENSION; i++) {
          queryVector[i] /= norm;
        }
      }

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
