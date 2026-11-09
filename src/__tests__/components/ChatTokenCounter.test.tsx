import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ChatTokenCounter,
  ChatPanel,
  CompressionNotice,
  formatTokenCount,
  calculateTokenProgress,
  DEFAULT_CONTEXT_CAPACITY,
  useChatTokens,
} from "@/components/chat/ChatPanel";
import * as tokenModule from "@/lib/context-compression/tokens";

describe("ChatTokenCounter & ChatPanel (#3476)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("formatTokenCount", () => {
    it("formats counts under 1000 as plain integers", () => {
      expect(formatTokenCount(0)).toBe("0");
      expect(formatTokenCount(12)).toBe("12");
      expect(formatTokenCount(800)).toBe("800");
      expect(formatTokenCount(999)).toBe("999");
    });

    it("formats thousands compactly with k suffix", () => {
      expect(formatTokenCount(1000)).toBe("1k");
      expect(formatTokenCount(1200)).toBe("1.2k");
      expect(formatTokenCount(7800)).toBe("7.8k");
      expect(formatTokenCount(8000)).toBe("8k");
      expect(formatTokenCount(12000)).toBe("12k");
    });

    it("handles negative numbers and NaN gracefully", () => {
      expect(formatTokenCount(-50)).toBe("0");
      expect(formatTokenCount(NaN)).toBe("0");
    });
  });

  describe("calculateTokenProgress", () => {
    it("derives percentage accurately", () => {
      const { percentage, clampedPercentage, isApproaching, isOverCapacity } =
        calculateTokenProgress(4000, 8000);
      expect(percentage).toBe(50);
      expect(clampedPercentage).toBe(50);
      expect(isApproaching).toBe(false);
      expect(isOverCapacity).toBe(false);
    });

    it("identifies approaching limit state at >= 80%", () => {
      const { clampedPercentage, isApproaching, isOverCapacity } =
        calculateTokenProgress(6800, 8000); // 85%
      expect(clampedPercentage).toBe(85);
      expect(isApproaching).toBe(true);
      expect(isOverCapacity).toBe(false);
    });

    it("clamps progress to 100% when exceeding capacity", () => {
      const { percentage, clampedPercentage, isApproaching, isOverCapacity } =
        calculateTokenProgress(10000, 8000); // 125%
      expect(percentage).toBe(125);
      expect(clampedPercentage).toBe(100);
      expect(isApproaching).toBe(false);
      expect(isOverCapacity).toBe(true);
    });

    it("handles zero and invalid inputs safely", () => {
      const zeroResult = calculateTokenProgress(0, 8000);
      expect(zeroResult.clampedPercentage).toBe(0);

      const nanResult = calculateTokenProgress(NaN, 8000);
      expect(nanResult.clampedPercentage).toBe(0);

      const negativeResult = calculateTokenProgress(-500, 8000);
      expect(negativeResult.clampedPercentage).toBe(0);
    });
  });

  describe("1. Token estimation", () => {
    it("renders the estimated token count for an empty conversation", () => {
      render(<ChatTokenCounter messages={[]} />);
      expect(screen.getByText("Context: 0 / 8k tokens")).toBeInTheDocument();

      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveAttribute("aria-valuenow", "0");
    });

    it("correctly derives the token count from a single message", () => {
      // "Hello world" is 11 chars -> Math.ceil(11/4) = 3 tokens
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: "Hello world" }]}
        />,
      );
      expect(screen.getByText("Context: 3 / 8k tokens")).toBeInTheDocument();
    });

    it("correctly derives the token count from multiple conversation messages", () => {
      // Turn 1 user: "Hello world" (11 chars -> 3 tokens)
      // Turn 2 assistant: "Hi there, I can help you find quiet cafes and coworking spaces." (63 chars -> 16 tokens)
      // Total = 19 tokens
      render(
        <ChatTokenCounter
          messages={[
            { role: "user", content: "Hello world" },
            {
              role: "assistant",
              content:
                "Hi there, I can help you find quiet cafes and coworking spaces.",
            },
          ]}
        />,
      );
      expect(screen.getByText("Context: 19 / 8k tokens")).toBeInTheDocument();
    });

    it("formats displayed token count compactly for representative long conversation history", () => {
      // 4800 chars -> 1200 tokens -> "1.2k"
      const longMessage = "a".repeat(4800);
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: longMessage }]}
        />,
      );
      expect(screen.getByText("Context: 1.2k / 8k tokens")).toBeInTheDocument();
    });
  });

  describe("2. Context capacity", () => {
    it("displays the configured maximum context capacity (default: 8k)", () => {
      expect(DEFAULT_CONTEXT_CAPACITY).toBe(8000);
      render(<ChatTokenCounter messages={[]} />);
      expect(screen.getByText(/8k tokens/)).toBeInTheDocument();
    });

    it("supports custom configured context capacities", () => {
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: "a".repeat(400) }]} // 100 tokens
          contextCapacity={4000}
        />,
      );
      expect(screen.getByText("Context: 100 / 4k tokens")).toBeInTheDocument();

      const progressbar = screen.getByRole("progressbar");
      // 100 / 4000 = 2.5% -> rounded to 3%
      expect(progressbar).toHaveAttribute("aria-valuenow", "3");
    });

    it("calculates progress correctly at exactly 50%", () => {
      // 16000 chars -> 4000 tokens. 4000 / 8000 = 50%
      const content = "a".repeat(16000);
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content }]}
          contextCapacity={8000}
        />,
      );
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveAttribute("aria-valuenow", "50");

      const bar = screen.getByTestId("token-progress-bar");
      expect(bar).toHaveStyle({ width: "50%" });
    });

    it("clamps progress to 100% when token usage exceeds capacity", () => {
      // 40000 chars -> 10000 tokens. 10000 / 8000 = 125% -> clamped to 100%
      const content = "a".repeat(40000);
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content }]}
          contextCapacity={8000}
        />,
      );
      expect(screen.getByText("Context: 10k / 8k tokens")).toBeInTheDocument();

      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveAttribute("aria-valuenow", "100");

      const bar = screen.getByTestId("token-progress-bar");
      expect(bar).toHaveStyle({ width: "100%" });

      expect(screen.getByText("Context limit exceeded")).toBeInTheDocument();
    });
  });

  describe("3. Compression notice", () => {
    it("is not displayed during normal uncompressed conversation", () => {
      render(
        <ChatTokenCounter
          messages={[
            { role: "user", content: "First message" },
            { role: "assistant", content: "Second message" },
          ]}
        />,
      );
      expect(
        screen.queryByText("Earlier messages compressed to preserve memory"),
      ).not.toBeInTheDocument();
    });

    it("does not show notice merely because token usage is high or over capacity without compression", () => {
      // High token usage, but no actual compression occurred
      const highTokens = "a".repeat(36000); // 9000 tokens > 8000
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: highTokens }]}
        />,
      );
      expect(
        screen.queryByText("Earlier messages compressed to preserve memory"),
      ).not.toBeInTheDocument();
    });

    it("appears when explicit isCompressed prop is true", () => {
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: "Hello" }]}
          isCompressed={true}
        />,
      );
      expect(
        screen.getByText("Earlier messages compressed to preserve memory"),
      ).toBeInTheDocument();
    });

    it("appears when conversation contains compressed system context from compressContext", () => {
      render(
        <ChatTokenCounter
          messages={[
            {
              role: "system",
              content:
                "[PRIOR CONTEXT & PARAMETERS]\nWork: focus | Type: cafe | Amenities: wifi, outlets",
            },
            { role: "user", content: "Show me places in Mission" },
            { role: "assistant", content: "Here are 3 quiet cafes..." },
          ]}
        />,
      );
      expect(
        screen.getByText("Earlier messages compressed to preserve memory"),
      ).toBeInTheDocument();
    });

    it("appears when a message has isCompressed: true or contextCompressed: true metadata", () => {
      render(
        <ChatTokenCounter
          messages={[
            {
              role: "assistant",
              content: "I recommend Sightglass Coffee.",
              isCompressed: true,
            },
          ]}
        />,
      );
      expect(
        screen.getByText("Earlier messages compressed to preserve memory"),
      ).toBeInTheDocument();
    });

    it("uses semantic role='status' for accessibility", () => {
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: "Hi" }]}
          isCompressed={true}
        />,
      );
      const notice = screen.getByRole("status");
      expect(notice).toHaveTextContent(
        "Earlier messages compressed to preserve memory",
      );
    });

    it("does not duplicate on component rerenders", () => {
      const { rerender } = render(
        <ChatTokenCounter
          messages={[{ role: "user", content: "Hi" }]}
          isCompressed={true}
        />,
      );

      expect(
        screen.getAllByText("Earlier messages compressed to preserve memory"),
      ).toHaveLength(1);

      // Rerender with identical compression state
      rerender(
        <ChatTokenCounter
          messages={[
            { role: "user", content: "Hi" },
            { role: "assistant", content: "Hello" },
          ]}
          isCompressed={true}
        />,
      );

      expect(
        screen.getAllByText("Earlier messages compressed to preserve memory"),
      ).toHaveLength(1);
    });
  });

  describe("4. Performance-sensitive behavior and typing responsiveness", () => {
    it("memoizes historical conversation tokens and avoids re-tokenizing history when draft input changes", () => {
      const estimateSpy = jest.spyOn(tokenModule, "estimateTokens");

      const initialMessages = [
        { role: "user", content: "Message one" },
        { role: "assistant", content: "Message two" },
      ];

      const { rerender } = render(
        <ChatTokenCounter messages={initialMessages} input="" />,
      );

      const callsAfterMount = estimateSpy.mock.calls.length;
      expect(callsAfterMount).toBeGreaterThanOrEqual(2);

      // Simulate typing a draft keystroke
      rerender(
        <ChatTokenCounter messages={initialMessages} input="Searching for..." />,
      );

      // The 2 historical messages should NOT be re-tokenized because `messages` reference didn't change.
      // Only the new `input` draft string should be estimated.
      const newCalls = estimateSpy.mock.calls.length - callsAfterMount;
      expect(newCalls).toBe(1);
      expect(estimateSpy).toHaveBeenLastCalledWith("Searching for...");

      estimateSpy.mockRestore();
    });

    it("includes active draft text in the live total estimate", () => {
      // "Hello" = 5 chars -> 2 tokens
      // draft input "World" = 5 chars -> 2 tokens
      // Total = 4 tokens
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: "Hello" }]}
          input="World"
        />,
      );
      expect(screen.getByText("Context: 4 / 8k tokens")).toBeInTheDocument();
    });
  });

  describe("5. Edge cases", () => {
    it("handles missing/undefined/null message content gracefully", () => {
      render(
        <ChatTokenCounter
          messages={[
            { role: "user", content: undefined } as any,
            { role: "assistant" } as any,
            null as any,
          ]}
        />,
      );
      expect(screen.getByText("Context: 0 / 8k tokens")).toBeInTheDocument();
    });

    it("handles message with empty string content", () => {
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: "" }]}
        />,
      );
      expect(screen.getByText("Context: 0 / 8k tokens")).toBeInTheDocument();
    });

    it("handles conversation reset back to empty state", () => {
      const { rerender } = render(
        <ChatTokenCounter
          messages={[
            { role: "user", content: "First" },
            { role: "assistant", content: "Second" },
          ]}
        />,
      );

      expect(screen.getByText(/Context: \d+ \/ 8k tokens/)).toBeInTheDocument();

      // Reset conversation
      rerender(<ChatTokenCounter messages={[]} />);
      expect(screen.getByText("Context: 0 / 8k tokens")).toBeInTheDocument();
    });

    it("handles token count exactly at context capacity", () => {
      // 32000 chars -> 8000 tokens
      const content = "a".repeat(32000);
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content }]}
          contextCapacity={8000}
        />,
      );
      expect(screen.getByText("Context: 8k / 8k tokens")).toBeInTheDocument();
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveAttribute("aria-valuenow", "100");
      expect(screen.getByText("Context limit exceeded")).toBeInTheDocument();
    });
  });

  describe("6. Accessibility", () => {
    it("progress bar includes all required ARIA attributes", () => {
      render(
        <ChatTokenCounter
          messages={[{ role: "user", content: "a".repeat(800) }]} // 200 tokens = 2.5% -> 3%
        />,
      );
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveAttribute(
        "aria-label",
        "Context window token usage",
      );
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "100");
      expect(progressbar).toHaveAttribute("aria-valuenow", "3");
      expect(progressbar).toHaveAttribute(
        "aria-valuetext",
        "Context: 200 / 8k tokens (3%)",
      );
    });
  });

  describe("7. ChatPanel integration", () => {
    it("renders messages, compression divider when compressed, and token counter", () => {
      render(
        <ChatPanel
          messages={[
            { id: "1", role: "user", content: "Find a quiet cafe" },
            { id: "2", role: "assistant", content: "Here are some options" },
          ]}
          isCompressed={true}
        />,
      );

      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
      expect(screen.getByText("Find a quiet cafe")).toBeInTheDocument();
      expect(screen.getByText("Here are some options")).toBeInTheDocument();
      expect(
        screen.getByText("Earlier messages compressed to preserve memory"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("chat-token-counter")).toBeInTheDocument();
    });

    it("renders children when provided", () => {
      render(
        <ChatPanel messages={[]}>
          <div data-testid="custom-child">Custom Message List</div>
        </ChatPanel>
      );
      expect(screen.getByTestId("custom-child")).toBeInTheDocument();
    });

    it("renders standalone CompressionNotice component with role status", () => {
      render(<CompressionNotice />);
      expect(
        screen.getByText("Earlier messages compressed to preserve memory"),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("evaluates useChatTokens hook correctly", () => {
      function HookHarness() {
        const stats = useChatTokens(
          [{ role: "user", content: "Hello world" }],
          "Draft",
          8000,
        );
        return (
          <div data-testid="hook-stats">
            {stats.totalTokens} - {stats.formattedUsage} / {stats.formattedCapacity}
          </div>
        );
      }
      render(<HookHarness />);
      expect(screen.getByTestId("hook-stats")).toHaveTextContent("5 - 5 / 8k");
    });
  });
});
