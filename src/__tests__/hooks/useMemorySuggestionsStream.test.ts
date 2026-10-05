import { renderHook, act } from "@testing-library/react";
import {
  useMemorySuggestionsStream,
  parseSSEChunk,
} from "@/hooks/useMemorySuggestionsStream";

describe("useMemorySuggestionsStream & parseSSEChunk (#4415)", () => {
  describe("parseSSEChunk", () => {
    it("parses valid SSE data lines with JSON payloads", () => {
      const raw = 'data: {"chunk":"Hello "}\n\ndata: {"chunk":"world!"}\n\n';
      const parsed = parseSSEChunk(raw);

      expect(parsed).toEqual([{ chunk: "Hello " }, { chunk: "world!" }]);
    });

    it("parses done signal", () => {
      const raw = 'data: {"done":true}\n\n';
      const parsed = parseSSEChunk(raw);

      expect(parsed).toEqual([{ done: true }]);
    });

    it("handles plain text data lines gracefully", () => {
      const raw = "data: plain text chunk\n\n";
      const parsed = parseSSEChunk(raw);

      expect(parsed).toEqual([{ chunk: "plain text chunk" }]);
    });
  });

  describe("useMemorySuggestionsStream Hook", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      jest.clearAllMocks();
    });

    it("initializes with empty text and idle streaming status", () => {
      const { result } = renderHook(() => useMemorySuggestionsStream());

      expect(result.current.text).toBe("");
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("progressively consumes stream chunks and updates text", async () => {
      const chunks = [
        'data: {"chunk":"Top "}\n\n',
        'data: {"chunk":"Quiet "}\n\n',
        'data: {"chunk":"Workspaces"}\n\n',
        'data: {"done":true}\n\n',
      ];

      const encoder = new TextEncoder();
      let chunkIdx = 0;

      const mockReadableStream = new ReadableStream({
        pull(controller) {
          if (chunkIdx < chunks.length) {
            controller.enqueue(encoder.encode(chunks[chunkIdx]));
            chunkIdx++;
          } else {
            controller.close();
          }
        },
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        body: mockReadableStream,
      });

      const { result } = renderHook(() => useMemorySuggestionsStream());

      let finalResult = "";
      await act(async () => {
        finalResult = await result.current.startStream("Find quiet workspace", [
          "Prefers low noise",
        ]);
      });

      expect(finalResult).toBe("Top Quiet Workspaces");
      expect(result.current.text).toBe("Top Quiet Workspaces");
      expect(result.current.isStreaming).toBe(false);
    });

    it("handles streaming error gracefully", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useMemorySuggestionsStream());

      await act(async () => {
        try {
          await result.current.startStream("Test prompt");
        } catch {
          // caught in test
        }
      });

      expect(result.current.error).toContain("HTTP 500");
      expect(result.current.isStreaming).toBe(false);
    });
  });
});
