"use client";

import { useState, useCallback, useRef } from "react";

export interface StreamChunkPayload {
  chunk?: string;
  done?: boolean;
  error?: string;
}

export interface UseMemorySuggestionsStreamResult {
  text: string;
  isStreaming: boolean;
  error: string | null;
  startStream: (prompt: string, memories?: string[]) => Promise<string>;
  cancelStream: () => void;
  reset: () => void;
}

/**
 * Parses raw SSE chunk lines into payload objects.
 */
export function parseSSEChunk(rawText: string): StreamChunkPayload[] {
  const lines = rawText.split("\n");
  const payloads: StreamChunkPayload[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const dataContent = trimmed.slice(5).trim();
      if (dataContent) {
        try {
          const parsed = JSON.parse(dataContent);
          payloads.push(parsed);
        } catch {
          // Non-JSON plain text fallback
          payloads.push({ chunk: dataContent });
        }
      }
    }
  }

  return payloads;
}

export function useMemorySuggestionsStream(): UseMemorySuggestionsStreamResult {
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    cancelStream();
    setText("");
    setError(null);
  }, [cancelStream]);

  const startStream = useCallback(
    async (prompt: string, memories: string[] = []): Promise<string> => {
      cancelStream();
      setText("");
      setError(null);
      setIsStreaming(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let accumulated = "";

      try {
        const response = await fetch("/api/ai/memory/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, memories }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Failed to stream suggestions (HTTP ${response.status})`,
          );
        }

        if (!response.body) {
          throw new Error("ReadableStream not supported by response");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const eventStr of events) {
            const payloads = parseSSEChunk(eventStr);
            for (const p of payloads) {
              if (p.error) {
                throw new Error(p.error);
              }
              if (p.chunk) {
                accumulated += p.chunk;
                setText((prev) => prev + (p.chunk || ""));
              }
              if (p.done) {
                break;
              }
            }
          }
        }

        return accumulated;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return accumulated;
        }
        const errorMsg =
          err instanceof Error ? err.message : "Error during streaming";
        setError(errorMsg);
        throw err;
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [cancelStream],
  );

  return {
    text,
    isStreaming,
    error,
    startStream,
    cancelStream,
    reset,
  };
}
