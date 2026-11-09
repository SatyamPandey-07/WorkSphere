/**
 * route.ts
 * API endpoint that orchestrates the parsing, embedding, and pgvector matching pipeline.
 * Accepts a resume file, processes it, and returns matched venues based on professional demographics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ResumeParser } from '@/core/ai/ResumeParser';
import { SkillEmbedder } from '@/core/ai/SkillEmbedder';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('resume') as File;

    if (!file) {
      return NextResponse.json({ error: 'No resume file provided.' }, { status: 400 });
    }

    // 1. Read file as ArrayBuffer to send to worker (simulated here for brevity, in real app use worker)
    const buffer = await file.arrayBuffer();
    
    // Mock worker response for scaffold
    const extractedText = 'John Doe\nSoftware Engineer\nSkills: TypeScript, React, Node.js, PostgreSQL\nExperience: 5 years building scalable web applications.';

    // 2. Parse the extracted text using Groq
    const parser = new ResumeParser(process.env.GROQ_API_KEY || 'mock-key');
    const parsedResume = await parser.parse(extractedText);

    // 3. Embed the extracted skills
    const embedder = new SkillEmbedder(process.env.OPENAI_API_KEY || 'mock-key');
    const skillEmbeddings = await embedder.embedSkills(parsedResume.skills);

    // 4. Mock pgvector matching logic
    // In production: SELECT venue_id, venue_name, 1 - (skill_embedding <=> query_embedding) AS similarity FROM venues ORDER BY similarity DESC LIMIT 5;
    const matchedVenues = [
      {
        id: 'venue-1',
        name: 'TechHub Coworking',
        matchScore: 0.92,
        reason: 'High density of Software Engineers and weekly React meetups.'
      },
      {
        id: 'venue-2',
        name: 'Innovate Loft',
        matchScore: 0.85,
        reason: 'Frequent Node.js workshops and strong startup community.'
      }
    ];

    return NextResponse.json({
      success: true,
      parsedResume,
      skillEmbeddingsCount: skillEmbeddings.length,
      matchedVenues
    }, { status: 200 });

  } catch (error) {
    console.error('Resume matching API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error during resume processing.' 
    }, { status: 500 });
  }
}