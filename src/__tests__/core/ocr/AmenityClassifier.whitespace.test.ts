import { describe, it, expect } from "vitest";
import {
  AmenityClassifier,
  amenityClassifier,
  type ExtractedTextBlock,
} from "@/core/ocr/AmenityClassifier";

describe("AmenityClassifier whitespace and deduplication", () => {
  const classifier = new AmenityClassifier();

  it("sanitizes tokens by stripping leading/trailing whitespace and collapsing internal whitespace and newlines", () => {
    expect(classifier.sanitizeToken("   Oat Milk   Latte \n\n  ")).toBe(
      "Oat Milk Latte"
    );
    expect(classifier.sanitizeToken("\t\r\nFree  WiFi  Password   \n")).toBe(
      "Free WiFi Password"
    );
    expect(classifier.sanitizeToken("")).toBe("");
  });

  it("tokenizes text with whitespace and newline normalization", () => {
    const raw = "  High-Speed \n\n  Wi-Fi \t and   \r\n Power   Outlets   ";
    const tokens = classifier.tokenize(raw);

    expect(tokens).toContain("high-speed");
    expect(tokens).toContain("wi-fi");
    expect(tokens).toContain("power");
    expect(tokens).toContain("outlets");
  });

  it("extracts, sanitizes, and deduplicates menu and amenity items case-insensitively", () => {
    const rawItems = [
      "  Avocado Toast \n ",
      "avocado toast",
      "AVOCADO   TOAST\n\n",
      "  Cold   Brew  \t",
      "cold brew",
      "  Oat   Milk   Cappuccino \r\n",
    ];

    const deduplicated = classifier.extractMenuItems(rawItems);

    expect(deduplicated).toEqual([
      "Avocado Toast",
      "Cold Brew",
      "Oat Milk Cappuccino",
    ]);
  });

  it("extracts and deduplicates items from ExtractedTextBlock array", () => {
    const blocks: ExtractedTextBlock[] = [
      {
        text: "  Vegan   Salad  \n",
        confidence: 0.9,
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
      {
        text: "vegan salad",
        confidence: 0.85,
        boundingBox: { x: 0, y: 15, width: 10, height: 10 },
      },
      {
        text: "  Espresso \t Machine  ",
        confidence: 0.95,
        boundingBox: { x: 0, y: 30, width: 10, height: 10 },
      },
    ];

    const result = classifier.extractMenuItems(blocks);
    expect(result).toEqual(["Vegan Salad", "Espresso Machine"]);
  });

  it("generates sanitized LLM prompt without duplicate menu tokens", () => {
    const blocks: ExtractedTextBlock[] = [
      {
        text: "  Free   WiFi  \n",
        confidence: 0.9,
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
      {
        text: "FREE WIFI\r\n",
        confidence: 0.88,
        boundingBox: { x: 0, y: 10, width: 10, height: 10 },
      },
    ];

    const prompt = classifier.generatePrompt(blocks);
    expect(prompt).toContain('"""\n    Free WiFi\n    """');
  });

  it("correctly classifies amenities even when raw OCR text contains irregular newlines and whitespace", () => {
    const rawOcr = `
      \t  Gigabit \r\n  Fiber   WiFi  (800 mbps)   
      \n\n Power \t Outlets   at   every   desk  
    `;

    const result = classifier.classify(rawOcr);
    const wifiAmenity = result.amenities.find((a) => a.category === "wifi");
    const powerAmenity = result.amenities.find((a) => a.category === "power");

    expect(wifiAmenity).toBeDefined();
    expect(wifiAmenity?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(powerAmenity).toBeDefined();
    expect(powerAmenity?.confidence).toBeGreaterThanOrEqual(0.55);
  });
});
