import {
  PromptCompressor,
  compressPrompt,
  VENUE_SCHEMA_DICTIONARY,
} from "@/lib/ai/PromptCompressor";

describe("PromptCompressor (Semantic Prompt Compression with Token Cache Dictionary)", () => {
  let compressor: PromptCompressor;

  beforeEach(() => {
    compressor = new PromptCompressor();
  });

  describe("Conversational Filler Pruning", () => {
    it("strips polite greetings and conversational filler phrases", () => {
      const input =
        "Hello there! Could you please find me a quiet meeting room? Thank you so much!";
      const result = compressor.stripFillers(input);

      expect(result).not.toContain("Hello there!");
      expect(result).not.toContain("Could you please");
      expect(result).not.toContain("Thank you so much!");
      expect(result).toContain("find me a quiet meeting room?");
    });

    it("preserves critical semantic negations and numbers", () => {
      const input =
        "Please do not book any venue with noiseLevel above 3 or wifiSpeedMbps under 50.";
      const compressed = compressor.compress(input).compressedPrompt;

      expect(compressed).toContain("do not");
      expect(compressed).toContain("3");
      expect(compressed).toContain("50");
    });
  });

  describe("Structured Entity Abbreviation", () => {
    it("abbreviates venue schema property keys correctly", () => {
      const prompt =
        'Filter venues where venueId is "v-1" and amenities includes "powerOutlets".';
      const abbreviated = compressor.abbreviateEntities(prompt);

      expect(abbreviated).toContain("vid");
      expect(abbreviated).toContain("amn");
      expect(abbreviated).toContain("pwr");
      expect(abbreviated).not.toContain("venueId");
      expect(abbreviated).not.toContain("amenities");
    });

    it("abbreviates JSON keys in structured prompt schemas", () => {
      const jsonPrompt =
        '{"venueId": "venue-42", "meeting_room": true, "wifiSpeedMbps": 200}';
      const abbreviated = compressor.abbreviateEntities(jsonPrompt);

      expect(abbreviated).toContain('"vid"');
      expect(abbreviated).toContain('"mtg_rm"');
      expect(abbreviated).toContain('"wifi"');
      expect(abbreviated).toContain("200");
    });

    it("verifies dictionary keys match domain concepts", () => {
      expect(VENUE_SCHEMA_DICTIONARY.venueId).toBe("vid");
      expect(VENUE_SCHEMA_DICTIONARY.meeting_room).toBe("mtg_rm");
      expect(VENUE_SCHEMA_DICTIONARY.phone_booth).toBe("pb");
      expect(VENUE_SCHEMA_DICTIONARY.hot_desk).toBe("hd");
    });
  });

  describe("Compression Telemetry Tracking", () => {
    it("tracks compression ratio, token savings, and savings percentage", () => {
      const verbosePrompt =
        "Hello there, as an AI assistant, could you please kindly search for venueName The Hive " +
        "with venueId HIVE-01, checking amenities for airConditioning and powerOutlets? Thank you in advance!";

      const { compressedPrompt, telemetry } = compressor.compress(verbosePrompt);

      expect(compressedPrompt.length).toBeLessThan(verbosePrompt.length);
      expect(telemetry.originalLength).toBe(verbosePrompt.length);
      expect(telemetry.compressedLength).toBe(compressedPrompt.length);
      expect(telemetry.tokensSaved).toBeGreaterThan(0);
      expect(telemetry.compressionRatio).toBeLessThan(1.0);
      expect(telemetry.savingsPercentage).toBeGreaterThanOrEqual(25);
      expect(telemetry.timestamp).toBeGreaterThan(0);
    });

    it("accumulates telemetry history and calculates average savings", () => {
      compressor.compress(
        "Could you please check availability and reservations for venueId v-10?",
      );
      compressor.compress(
        "Hi there, would you kindly list meeting_room options with openingHours 9-5?",
      );

      const history = compressor.getTelemetryHistory();
      expect(history).toHaveLength(2);

      const avgSavings = compressor.getAverageSavingsPercentage();
      expect(avgSavings).toBeGreaterThan(0);

      compressor.clearTelemetry();
      expect(compressor.getTelemetryHistory()).toHaveLength(0);
    });

    it("handles empty or falsy prompts gracefully", () => {
      const { compressedPrompt, telemetry } = compressor.compress("");
      expect(compressedPrompt).toBe("");
      expect(telemetry.tokensSaved).toBe(0);
      expect(telemetry.compressionRatio).toBe(1.0);
    });
  });

  describe("compressPrompt Helper Function", () => {
    it("provides one-shot prompt compression", () => {
      const prompt =
        "Please kindly show me hot_desk availability for venueId 42.";
      const result = compressPrompt(prompt);

      expect(result.compressedPrompt).toContain("hd");
      expect(result.compressedPrompt).toContain("avail");
      expect(result.compressedPrompt).toContain("vid 42");
      expect(result.telemetry.tokensSaved).toBeGreaterThan(0);
    });
  });
});
