/**
 * AmenityClassifier.ts
 * Formats the extracted raw text into structured prompts for the Groq LLM to classify venue amenities.
 * Maps unstructured OCR output to structured JSON metadata.
 */

export interface ExtractedTextBlock {
    text: string;
    confidence: number;
    boundingBox: { x: number; y: number; width: number; height: number };
}

export interface VenueAmenities {
    hasWifi: boolean;
    hasPowerOutlets: boolean;
    hasVeganOptions: boolean;
    hasEspressoMachine: boolean;
    noiseLevel: 'quiet' | 'moderate' | 'loud' | 'unknown';
    rawText: string;
}

export class AmenityClassifier {
    public generatePrompt(extractedBlocks: ExtractedTextBlock[]): string {
        const rawText = extractedBlocks.map(b => b.text).join('\n');

        return `You are an expert venue analyst. Analyze the following text extracted from a cafe's menu or amenities board.
    Determine if the venue has the following amenities:
    1. WiFi (look for "WiFi", "Free Internet", passwords)
    2. Power Outlets (look for "plugs", "charging", "laptop friendly")
    3. Vegan Options (look for "vegan", "plant-based", "dairy-free")
    4. Espresso Machine (look for "espresso", "latte", "cappuccino", "barista")
    5. Noise Level (infer from words like "quiet zone", "library", "bustling", "live music")

    Text:
    """
    ${rawText}
    """

    Respond ONLY with a valid JSON object matching this schema:
    {
      "hasWifi": boolean,
      "hasPowerOutlets": boolean,
      "hasVeganOptions": boolean,
      "hasEspressoMachine": boolean,
      "noiseLevel": "quiet" | "moderate" | "loud" | "unknown"
    }`;
    }

    public parseLLMResponse(llmOutput: string): VenueAmenities {
        try {
            // Extract JSON from potential markdown code blocks
            const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
            const jsonString = jsonMatch ? jsonMatch[0] : llmOutput;
            const parsed = JSON.parse(jsonString);

            return {
                hasWifi: !!parsed.hasWifi,
                hasPowerOutlets: !!parsed.hasPowerOutlets,
                hasVeganOptions: !!parsed.hasVeganOptions,
                hasEspressoMachine: !!parsed.hasEspressoMachine,
                noiseLevel: parsed.noiseLevel || 'unknown',
                rawText: llmOutput
            };
        } catch (e) {
            console.error('Failed to parse LLM amenity response:', e);
            return {
                hasWifi: false,
                hasPowerOutlets: false,
                hasVeganOptions: false,
                hasEspressoMachine: false,
                noiseLevel: 'unknown',
                rawText: llmOutput
            };
        }
    }
}
