import { formatChatHistoryMarkdown, generateChatPdfReport } from "@/lib/chatExport";
import { Message } from "@/components/chat/ChatMessages";
import { PDFDocument } from "pdf-lib";

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

    it("handles null, undefined, or empty messages gracefully in markdown export", () => {
      expect(formatChatHistoryMarkdown(undefined)).toContain("No conversation messages recorded.");
      expect(formatChatHistoryMarkdown(null as any)).toContain("No conversation messages recorded.");
      expect(formatChatHistoryMarkdown([])).toContain("No conversation messages recorded.");
    });

    it("skips invalid coordinates in map location links without error", () => {
      const messagesWithBadCoords: Message[] = [
        {
          id: "msg-bad-coord",
          role: "assistant",
          content: "Here is a venue without coords:",
          venues: [
            {
              id: "v-no-coord",
              name: "No Coord Cafe",
              lat: NaN as any,
              lng: undefined as any,
            },
          ],
        },
      ];

      const md = formatChatHistoryMarkdown(messagesWithBadCoords);
      expect(md).toContain("**No Coord Cafe**");
      expect(md).not.toContain("https://maps.google.com/?q=NaN,undefined");
    });
  });

  describe("generateChatPdfReport", () => {
    it("generates a valid PDF byte array from conversation history", async () => {
      const pdfBytes = await generateChatPdfReport(sampleMessages);

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(0);
      const header = String.fromCharCode(...pdfBytes.slice(0, 5));
      expect(header).toBe("%PDF-");

      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    });

    it("handles null, undefined, and empty messages safely without throwing", async () => {
      const pdfNull = await generateChatPdfReport(null as any);
      expect(pdfNull).toBeInstanceOf(Uint8Array);
      expect(pdfNull.length).toBeGreaterThan(100);

      const pdfUndef = await generateChatPdfReport(undefined);
      expect(pdfUndef).toBeInstanceOf(Uint8Array);
      expect(pdfUndef.length).toBeGreaterThan(100);

      const pdfEmpty = await generateChatPdfReport([]);
      expect(pdfEmpty).toBeInstanceOf(Uint8Array);
      expect(pdfEmpty.length).toBeGreaterThan(100);

      const doc = await PDFDocument.load(pdfEmpty);
      expect(doc.getPageCount()).toBe(1);
    });

    it("wraps long messages beyond 200 characters across multiple lines", async () => {
      const longMessageText =
        "WorkSphere AI provides real-time workspace intelligence for digital nomads across more than 40 global hubs. Our recommendations analyze live telemetry data, Wi-Fi latency, quiet hours, acoustic noise dosimetry, power outlet availability, and desk reservation capacity to deliver productive work sessions.";
      expect(longMessageText.length).toBeGreaterThan(250);

      const longMessages: Message[] = [
        {
          id: "msg-long-1",
          role: "assistant",
          content: longMessageText,
          venues: [
            {
              id: "v-tokyo-1",
              name: "Tokyo Innovation Space & Cafe",
              category: "Coworking Lounge",
              address: "1-1 Shibuya, Tokyo, Japan",
              wifiSpeed: 250,
              hasOutlets: true,
              noiseLevel: "quiet",
            },
          ],
        },
      ];

      const pdfBytes = await generateChatPdfReport(longMessages);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(500);

      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    });

    it("skips nullish elements in messages array and handles empty content", async () => {
      const dirtyMessages = [
        null,
        undefined,
        { id: "msg-dirty-1", role: "user", content: "" },
        { id: "msg-dirty-2", role: "assistant", content: null as any },
      ];

      const pdfBytes = await generateChatPdfReport(dirtyMessages as any);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(100);
    });
  });
});
