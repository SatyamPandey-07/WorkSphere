/**
 * AmenityClassifier.ts
 * Combines tokenization, regex dictionary pattern matching, and confidence score scoring
 * pipeline along with Groq LLM prompt formatting and confidence badges for venue amenity extraction.
 */

export type AmenityCategory =
  | "wifi"
  | "power"
  | "quiet"
  | "coffee"
  | "standing_desk";

export interface AmenityPattern {
  regex: RegExp;
  weight: number;
}

export interface AmenityDefinition {
  category: AmenityCategory;
  displayName: string;
  patterns: AmenityPattern[];
  minConfidenceThreshold: number;
}

export type AmenityConfidenceTier = "high" | "moderate" | "low";

export interface AmenityConfidenceBadge {
  label: string;
  tier: AmenityConfidenceTier;
  percentage: number;
  color: string;
  variant?: "success" | "warning" | "info" | "neutral";
  bgClass?: string;
  textClass?: string;
  borderClass?: string;
}

export interface ClassifiedAmenity {
  category: AmenityCategory;
  displayName: string;
  confidence: number;
  matchedKeywords: string[];
  confidenceBadge?: string;
  confidenceTier?: AmenityConfidenceTier;
  confidenceScoreBadge?: AmenityConfidenceBadge;
}

export interface ClassificationResult {
  amenities: ClassifiedAmenity[];
  tokens: string[];
  rawText: string;
}

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
  noiseLevel: "quiet" | "moderate" | "loud" | "unknown";
  rawText: string;
}

export const AMENITY_DEFINITIONS: Record<AmenityCategory, AmenityDefinition> = {
  wifi: {
    category: "wifi",
    displayName: "High-Speed Wi-Fi",
    minConfidenceThreshold: 0.6,
    patterns: [
      { regex: /\b(high[- ]?speed|gigabit|fiber|ultra[- ]?fast)\s+(wi[- ]?fi|wifi|internet)\b/i, weight: 0.95 },
      { regex: /\b(wi[- ]?fi|wifi|wlan|internet)\b/i, weight: 0.75 },
      { regex: /\b(\d+)\s*(mbps|gbps)\b/i, weight: 0.85 },
      { regex: /\b(broadband|ethernet|lan)\b/i, weight: 0.7 },
    ],
  },
  power: {
    category: "power",
    displayName: "Power Outlets",
    minConfidenceThreshold: 0.55,
    patterns: [
      { regex: /\b(power\s+outlets?|wall\s+sockets?|charging\s+stations?)\b/i, weight: 0.9 },
      { regex: /\b(outlets?|sockets?|plugs?|chargers?)\s+at\s+every\s+(desk|seat|table)\b/i, weight: 0.95 },
      { regex: /\b(usb[- ]?c|power\s+strip|surge\s+protector)\b/i, weight: 0.8 },
      { regex: /\b(electric|power|ac\s+outlet)\b/i, weight: 0.6 },
    ],
  },
  quiet: {
    category: "quiet",
    displayName: "Quiet Zone / Soundproof",
    minConfidenceThreshold: 0.6,
    patterns: [
      { regex: /\b(soundproof\s+booths?|phone\s+booths?|quiet\s+zones?|silent\s+rooms?)\b/i, weight: 0.95 },
      { regex: /\b(quiet|peaceful|silent|noise[- ]?free|low\s+noise)\b/i, weight: 0.75 },
      { regex: /\b(acoustic\s+(panels?|insulation|baffles?))\b/i, weight: 0.85 },
      { regex: /\b(no\s+calls|silent\s+study|focus\s+area)\b/i, weight: 0.8 },
    ],
  },
  coffee: {
    category: "coffee",
    displayName: "Specialty Coffee & Tea",
    minConfidenceThreshold: 0.55,
    patterns: [
      { regex: /\b(specialty\s+coffee|espresso\s+bar|artisan\s+roast|barista)\b/i, weight: 0.95 },
      { regex: /\b(free\s+coffee|unlimited\s+tea|pour[- ]?over|cappuccino|latte)\b/i, weight: 0.85 },
      { regex: /\b(coffee|tea|cafe|cafeteria|cold\s+brew)\b/i, weight: 0.7 },
      { regex: /\b(beverage\s+station|kettle|coffee\s+machine)\b/i, weight: 0.75 },
    ],
  },
  standing_desk: {
    category: "standing_desk",
    displayName: "Ergonomic Standing Desks",
    minConfidenceThreshold: 0.6,
    patterns: [
      { regex: /\b(motorized\s+standing\s+desks?|electric\s+height[- ]?adjustable\s+desks?)\b/i, weight: 0.95 },
      { regex: /\b(standing\s+desks?|sit[- ]?to[- ]?stand|height[- ]?adjustable\s+desks?)\b/i, weight: 0.9 },
      { regex: /\b(ergonomic\s+(chairs?|workstations?|desks?)|herman\s+miller)\b/i, weight: 0.8 },
      { regex: /\b(stand[- ]?up\s+desks?|adjustable\s+workstations?)\b/i, weight: 0.85 },
    ],
  },
};

export class AmenityClassifier {
  private definitions: Record<AmenityCategory, AmenityDefinition>;

  constructor(customDefinitions?: Record<AmenityCategory, AmenityDefinition>) {
    this.definitions = customDefinitions ?? AMENITY_DEFINITIONS;
  }

  /**
   * Sanitizes OCR tokens by stripping leading/trailing whitespace,
   * collapsing internal whitespace sequences (including newlines) to single spaces.
   */
  public sanitizeToken(token: string): string {
    if (!token) return "";
    return token.trim().replace(/\s+/g, " ");
  }

  /**
   * Tokenizes text into normalized words with whitespace sanitization.
   */
  public tokenize(text: string): string[] {
    if (!text) return [];
    const sanitized = this.sanitizeToken(text);
    return sanitized
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .map((t) => this.sanitizeToken(t))
      .filter((token) => token.length > 1);
  }

  /**
   * Extracts, sanitizes, and deduplicates menu and amenity items case-insensitively
   * from raw OCR string or text blocks.
   */
  public extractMenuItems(items: string[] | ExtractedTextBlock[]): string[] {
    if (!items || items.length === 0) return [];

    const rawStrings = items.map((item) =>
      typeof item === "string" ? item : item.text
    );

    const seen = new Set<string>();
    const sanitizedItems: string[] = [];

    for (const raw of rawStrings) {
      const sanitized = this.sanitizeToken(raw);
      if (!sanitized) continue;

      const lower = sanitized.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        sanitizedItems.push(sanitized);
      }
    }

    return sanitizedItems;
  }

  /**
   * Evaluates text against regex dictionaries and computes confidence scores with badges.
   */
  public classify(rawText: string): ClassificationResult {
    const cleanRawText = this.sanitizeToken(rawText);
    const tokens = this.tokenize(cleanRawText);
    const classifiedAmenities: ClassifiedAmenity[] = [];

    for (const key of Object.keys(this.definitions) as AmenityCategory[]) {
      const def = this.definitions[key];
      const matchedKeywords: string[] = [];
      let matchCount = 0;

      for (const pattern of def.patterns) {
        const match = rawText.match(pattern.regex);
        if (match) {
          matchedKeywords.push(match[0].trim());
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const highestWeight = Math.max(
          ...def.patterns.filter((p) => p.regex.test(rawText)).map((p) => p.weight),
          0
        );
        const frequencyBonus = Math.min(0.15, (matchCount - 1) * 0.05);
        const calculatedConfidence = Math.min(1.0, highestWeight + frequencyBonus);

        if (calculatedConfidence >= def.minConfidenceThreshold) {
          const roundedConfidence = Math.round(calculatedConfidence * 100) / 100;
          const badge = this.getConfidenceBadge(roundedConfidence);
          classifiedAmenities.push({
            category: def.category,
            displayName: def.displayName,
            confidence: roundedConfidence,
            matchedKeywords: Array.from(new Set(matchedKeywords)),
            confidenceBadge: badge.label,
            confidenceTier: badge.tier,
            confidenceScoreBadge: badge,
          });
        }
      }
    }

    classifiedAmenities.sort((a, b) => b.confidence - a.confidence);

    return {
      amenities: classifiedAmenities,
      tokens,
      rawText,
    };
  }

  /**
   * Generates a confidence score badge metadata object for a detected amenity.
   */
  public getConfidenceBadge(confidence: number): AmenityConfidenceBadge {
    const percentage = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
    let tier: AmenityConfidenceTier = "low";
    let color = "blue";
    let variant: "success" | "warning" | "info" | "neutral" = "info";
    let bgClass = "bg-blue-500/10";
    let textClass = "text-blue-400";
    let borderClass = "border-blue-500/20";

    if (confidence >= 0.85) {
      tier = "high";
      color = "emerald";
      variant = "success";
      bgClass = "bg-emerald-500/10";
      textClass = "text-emerald-400";
      borderClass = "border-emerald-500/20";
    } else if (confidence >= 0.7) {
      tier = "moderate";
      color = "amber";
      variant = "warning";
      bgClass = "bg-amber-500/10";
      textClass = "text-amber-400";
      borderClass = "border-amber-500/20";
    }

    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const label = `${percentage}% ${tierLabel} Confidence`;

    return {
      label,
      tier,
      percentage,
      color,
      variant,
      bgClass,
      textClass,
      borderClass,
    };
  }

  /**
   * Formats extracted raw text into structured prompts for Groq LLM.
   */
  public generatePrompt(extractedBlocks: ExtractedTextBlock[]): string {
    const sanitizedItems = this.extractMenuItems(extractedBlocks);
    const rawText = sanitizedItems.join("\n");

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

  /**
   * Parses Groq LLM JSON response into structured VenueAmenities.
   */
  public parseLLMResponse(llmOutput: string): VenueAmenities {
    try {
      const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : llmOutput;
      const parsed = JSON.parse(jsonString);

      return {
        hasWifi: !!parsed.hasWifi,
        hasPowerOutlets: !!parsed.hasPowerOutlets,
        hasVeganOptions: !!parsed.hasVeganOptions,
        hasEspressoMachine: !!parsed.hasEspressoMachine,
        noiseLevel: parsed.noiseLevel || "unknown",
        rawText: llmOutput,
      };
    } catch (e) {
      console.error("Failed to parse LLM amenity response:", e);
      return {
        hasWifi: false,
        hasPowerOutlets: false,
        hasVeganOptions: false,
        hasEspressoMachine: false,
        noiseLevel: "unknown",
        rawText: llmOutput,
      };
    }
  }
}

export const amenityClassifier = new AmenityClassifier();