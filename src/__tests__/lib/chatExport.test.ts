import { formatChatHistoryMarkdown, generateChatPdfReport } from "@/lib/chatExport";
import { Message } from "@/components/chat/ChatMessages";

describe("Chat Export Formatting", () => {
  const sampleMessages: Message[] = [
    {
      id: "msg-1",
      role: "user",
      content: "Find quiet cafes with fast WiFi in San Francisco",
    },
    {
      id: "msg-2",
      role: "assistant",
      content: "Here are some top workspace recommendations in San Francisco:",
      venues: [
        {
          id: "v1",
          name: "Blue Bottle Coffee",
          category: "cafe",
          address: "66 Mint St, San Francisco, CA",
          wifiSpeed: 150,
          hasOutlets: true,
          noiseLevel: "quiet",
          lat: 37.7825,
          lng: -122.4048,
        },
      ],
    },
  ];

  describe("formatChatHistoryMarkdown", () => {
    it("formats chat history with user messages, AI recommendations, and map details into markdown", () => {
      const md = formatChatHistoryMarkdown(sampleMessages);

      expect(md).toContain("# WorkSphere AI Chat Conversation Export");
      expect(md).toContain("### User");
      expect(md).toContain("Find quiet cafes with fast WiFi in San Francisco");
      expect(md).toContain("### WorkSphere AI");
      expect(md).toContain("Here are some top workspace recommendations in San Francisco:");
      expect(md).toContain("**Blue Bottle Coffee** (cafe)");
      expect(md).toContain("66 Mint St, San Francisco, CA");
      expect(md).toContain("150 Mbps");
      expect(md).toContain("Power Outlets: Yes");
      expect(md).toContain("Noise Level: quiet");
      expect(md).toContain("https://maps.google.com/?q=37.7825,-122.4048");
    });
  });

  describe("generateChatPdfReport", () => {
    it("generates a valid PDF byte array from conversation history", async () => {
      const pdfBytes = await generateChatPdfReport(sampleMessages);

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
      // PDF header magic bytes %PDF-
      const header = String.fromCharCode(...pdfBytes.slice(0, 5));
      expect(header).toBe("%PDF-");
    });
  });
});
