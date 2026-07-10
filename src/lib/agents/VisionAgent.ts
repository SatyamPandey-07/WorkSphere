import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'dummy-key-for-build',
});

export interface VisionAnalysisResult {
  isWorkspace: boolean;
  visibleOutlets: boolean;
  outdoorSeating: boolean;
  confidenceScore: number;
}

export async function analyzeVenueImage(
  imageUrl: string,
  claimedAmenities: { hasOutlets?: boolean; category?: string }
): Promise<VisionAnalysisResult> {
  try {
    const prompt = `
You are a moderation agent for a remote work venue directory.
Analyze this image and return a strict JSON object with the following properties (and nothing else):
- "isWorkspace": (boolean) true if the image appears to be a cafe, library, coworking space, or suitable place to work. False if it is irrelevant (e.g. a picture of a dog, a car, an empty field).
- "visibleOutlets": (boolean) true if you can clearly see power outlets in the image.
- "outdoorSeating": (boolean) true if there is outdoor seating visible.
- "confidenceScore": (number 0-100) your confidence in this analysis.

The user claims this venue is a "${claimedAmenities.category || 'workspace'}" and hasOutlets: ${claimedAmenities.hasOutlets}.
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      model: 'llama-3.2-90b-vision-preview',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 256,
    });

    const resultString = chatCompletion.choices[0]?.message?.content || '{}';
    const result = JSON.parse(resultString) as VisionAnalysisResult;

    return {
      isWorkspace: result.isWorkspace ?? true,
      visibleOutlets: result.visibleOutlets ?? false,
      outdoorSeating: result.outdoorSeating ?? false,
      confidenceScore: result.confidenceScore ?? 100,
    };
  } catch (error) {
    console.error('VisionAgent Error:', error);
    // On failure, return a safe default that doesn't falsely flag everything
    return {
      isWorkspace: true,
      visibleOutlets: claimedAmenities.hasOutlets ?? false,
      outdoorSeating: false,
      confidenceScore: 50,
    };
  }
}
