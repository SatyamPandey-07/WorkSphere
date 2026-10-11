/**
 * ResumeParser.ts
 * Interfaces with the Groq API to extract structured skills, industries, and seniority levels from raw resume text.
 * Utilizes strict JSON schema enforcement to ensure predictable downstream processing.
 */

import { Groq } from 'groq-sdk';

export interface ParsedResume {
    fullName: string;
    email: string;
    skills: string[];
    industries: string[];
    seniorityLevel: 'Entry' | 'Mid' | 'Senior' | 'Executive';
    yearsOfExperience: number;
    summary: string;
}

const RESUME_PARSING_PROMPT = `
You are an expert HR data extraction AI. Analyze the provided resume text and extract the following information into a strict JSON format.
If a field cannot be determined, use "Unknown" for strings, empty arrays for lists, and 0 for numbers.
Do not include any markdown formatting or explanations, only valid JSON.

Required JSON Schema:
{
  "fullName": "string",
  "email": "string",
  "skills": ["string"],
  "industries": ["string"],
  "seniorityLevel": "Entry" | "Mid" | "Senior" | "Executive",
  "yearsOfExperience": number,
  "summary": "string"
}
`;

export class ResumeParser {
    private client: Groq;

    constructor(apiKey: string) {
        this.client = new Groq({ apiKey });
    }

    /**
     * Parses raw resume text into a structured ParsedResume object.
     * @param resumeText The raw text content of the resume.
     * @returns A promise resolving to the structured ParsedResume.
     */
    public async parse(resumeText: string): Promise<ParsedResume> {
        if (!resumeText || resumeText.trim().length < 50) {
            throw new Error('Resume text is too short or invalid.');
        }

        try {
            const completion = await this.client.chat.completions.create({
                messages: [
                    { role: 'system', content: RESUME_PARSING_PROMPT },
                    { role: 'user', content: resumeText }
                ],
                model: 'llama3-70b-8192',
                temperature: 0.1,
                response_format: { type: 'json_object' }
            });

            const content = completion.choices[0]?.message?.content;
            if (!content) {
                throw new Error('Empty response from Groq API.');
            }

            const parsedData = JSON.parse(content) as Partial<ParsedResume>;

            // Validate and sanitize the output
            return {
                fullName: parsedData.fullName || 'Unknown',
                email: parsedData.email || 'Unknown',
                skills: Array.isArray(parsedData.skills) ? parsedData.skills : [],
                industries: Array.isArray(parsedData.industries) ? parsedData.industries : [],
                seniorityLevel: ['Entry', 'Mid', 'Senior', 'Executive'].includes(parsedData.seniorityLevel || '')
                    ? (parsedData.seniorityLevel as ParsedResume['seniorityLevel'])
                    : 'Mid',
                yearsOfExperience: typeof parsedData.yearsOfExperience === 'number' ? parsedData.yearsOfExperience : 0,
                summary: parsedData.summary || 'No summary provided.'
            };
        } catch (error) {
            console.error('Error parsing resume:', error);
            throw new Error('Failed to parse resume. Please ensure the text is legible.');
        }
    }
}
