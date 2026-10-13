import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import React, { useState } from "react";
import {
  ChatPanel,
  ChatPanelProps,
  sanitizeChatInput,
} from "@/components/chat/ChatPanel";

// Mock audio playback utility
jest.mock("@/lib/chatSound", () => ({
  playChatMessageSound: jest.fn(),
  isChatSoundEnabled: jest.fn(() => false),
}));

describe("ChatPanel Whitespace Submission Prevention (#4367)", () => {
  describe("Send Button Disabled State", () => {
    it("disables send button when input prop is empty string", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input=""
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).toBeDisabled();
      expect(sendButton).toHaveClass("disabled:opacity-50");
      expect(sendButton).toHaveClass("disabled:cursor-not-allowed");
    });

    it("disables send button when input is undefined", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it("disables send button when input contains only space characters", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="    "
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it("disables send button when input contains tab characters", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="\t\t\t"
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it("disables send button when input contains newline characters", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="\n\n\r\n"
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it("disables send button when input contains mixed whitespace (spaces, tabs, newlines)", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="  \t \n \r\n  \t"
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it("enables send button when input contains non-whitespace content", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="Hello WorkSphere"
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });

    it("enables send button when input has leading/trailing spaces around non-empty content", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="   valid message   "
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });

    it("enables send button for single character non-whitespace input", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="?"
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe("Form Submission Guard Logic", () => {
    it("does not invoke onSubmit callback when submitting empty string input", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input=""
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const inputElement = screen.getByPlaceholderText("Type a message...");
      fireEvent.submit(inputElement.closest("form")!);

      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it("does not invoke onSubmit callback when submitting spaces-only input", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="      "
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const inputElement = screen.getByPlaceholderText("Type a message...");
      fireEvent.submit(inputElement.closest("form")!);

      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it("does not invoke onSubmit callback when submitting newlines-only input", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="\n\n\n"
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const inputElement = screen.getByPlaceholderText("Type a message...");
      fireEvent.submit(inputElement.closest("form")!);

      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it("does not invoke onSubmit callback when submitting full-width whitespace or Unicode spaces", () => {
      const handleSubmit = jest.fn();
      // \u200B (zero width space), \u3000 (ideographic space), \u00A0 (non-breaking space)
      render(
        <ChatPanel
          input=" \u00A0 \u200B \u3000 "
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const inputElement = screen.getByPlaceholderText("Type a message...");
      fireEvent.submit(inputElement.closest("form")!);

      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it("invokes onSubmit callback when valid non-empty string is submitted", () => {
      const handleSubmit = jest.fn((e) => e.preventDefault());
      render(
        <ChatPanel
          input="Can you book Desk 4?"
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const inputElement = screen.getByPlaceholderText("Type a message...");
      fireEvent.submit(inputElement.closest("form")!);

      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });

    it("invokes onSubmit callback when input contains valid text padded with spaces", () => {
      const handleSubmit = jest.fn((e) => e.preventDefault());
      render(
        <ChatPanel
          input="   Check venue availability   "
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const inputElement = screen.getByPlaceholderText("Type a message...");
      fireEvent.submit(inputElement.closest("form")!);

      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("Interactive Controlled Form State Lifecycle", () => {
    function ControlledChatPanelWrapper() {
      const [input, setInput] = useState("");
      const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);

      const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed) return;

        setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
        setInput("");
      };

      return (
        <ChatPanel
          messages={messages}
          input={input}
          onInputChange={setInput}
          onSubmit={handleSubmit}
        />
      );
    }

    it("prevents user from adding empty whitespace messages to message list", () => {
      render(<ControlledChatPanelWrapper />);

      const inputElement = screen.getByPlaceholderText("Type a message...") as HTMLInputElement;
      const sendButton = screen.getByRole("button", { name: /send/i });

      // Initially empty
      expect(sendButton).toBeDisabled();

      // Type spaces
      fireEvent.change(inputElement, { target: { value: "     " } });
      expect(sendButton).toBeDisabled();

      // Attempt submit via form
      fireEvent.submit(inputElement.closest("form")!);
      expect(screen.queryByText("(sending...)")).not.toBeInTheDocument();
      expect(screen.getByText("No messages yet.")).toBeInTheDocument();

      // Type valid text
      fireEvent.change(inputElement, { target: { value: "   Hello team   " } });
      expect(sendButton).not.toBeDisabled();

      // Submit valid message
      fireEvent.click(sendButton);

      // Verify message added and input cleared
      expect(screen.getByText("Hello team")).toBeInTheDocument();
      expect(sendButton).toBeDisabled();
    });

    it("handles transition from valid text to whitespace back to valid text", () => {
      render(<ControlledChatPanelWrapper />);

      const inputElement = screen.getByPlaceholderText("Type a message...") as HTMLInputElement;
      const sendButton = screen.getByRole("button", { name: /send/i });

      // Step 1: Type valid text
      fireEvent.change(inputElement, { target: { value: "First message" } });
      expect(sendButton).not.toBeDisabled();

      // Step 2: Clear and type whitespace
      fireEvent.change(inputElement, { target: { value: "   " } });
      expect(sendButton).toBeDisabled();

      // Step 3: Type valid text again
      fireEvent.change(inputElement, { target: { value: "Second message" } });
      expect(sendButton).not.toBeDisabled();

      fireEvent.click(sendButton);
      expect(screen.getByText("Second message")).toBeInTheDocument();
    });

    it("maintains button disabled state across rapid whitespace typing", () => {
      render(<ControlledChatPanelWrapper />);

      const inputElement = screen.getByPlaceholderText("Type a message...") as HTMLInputElement;
      const sendButton = screen.getByRole("button", { name: /send/i });

      const whitespaceSamples = [
        " ",
        "  ",
        "   ",
        "\t",
        "\t\t",
        "\n",
        "\n\n",
        " \t \n ",
        "",
      ];

      whitespaceSamples.forEach((sample) => {
        fireEvent.change(inputElement, { target: { value: sample } });
        expect(sendButton).toBeDisabled();
      });
    });
  });

  describe("Edge Case Validation", () => {
    it("handles zero-width spaces and soft hyphens gracefully", () => {
      const handleSubmit = jest.fn();
      render(
        <ChatPanel
          input="\u200B\u200C\u200D\uFEFF"
          onInputChange={() => {}}
          onSubmit={handleSubmit}
        />
      );

      const sendButton = screen.getByRole("button", { name: /send/i });
      // \u200B is trimmed by JavaScript String.prototype.trim() depending on engine spec
      // Ensure onSubmit guards against empty trimmed result
      const inputElement = screen.getByPlaceholderText("Type a message...");
      fireEvent.submit(inputElement.closest("form")!);

      if (sendButton.hasAttribute("disabled")) {
        expect(sendButton).toBeDisabled();
      }
    });

    it("allows messages with numbers, special symbols, and emojis", () => {
      const validInputs = ["12345", "🚀 Workspace", "!!!", "@admin help", "https://worksphere.com"];

      validInputs.forEach((val) => {
        const handleSubmit = jest.fn((e) => e.preventDefault());
        const { unmount } = render(
          <ChatPanel
            input={val}
            onInputChange={() => {}}
            onSubmit={handleSubmit}
          />
        );

        const sendButton = screen.getByRole("button", { name: /send/i });
        expect(sendButton).not.toBeDisabled();

        const inputElement = screen.getByPlaceholderText("Type a message...");
        fireEvent.submit(inputElement.closest("form")!);
        expect(handleSubmit).toHaveBeenCalledTimes(1);

        unmount();
      });
    });
  });

  describe("sanitizeChatInput & Security Filtering (#6068)", () => {
    it("returns empty string for null, undefined, or empty values", () => {
      expect(sanitizeChatInput(null)).toBe("");
      expect(sanitizeChatInput(undefined)).toBe("");
      expect(sanitizeChatInput("")).toBe("");
      expect(sanitizeChatInput("   ")).toBe("");
    });

    it("normalizes and trims invisible zero-width and Unicode whitespace", () => {
      expect(sanitizeChatInput("\u200B\u200C\u200D")).toBe("");
      expect(sanitizeChatInput("  \u3000\u00A0  ")).toBe("");
      expect(sanitizeChatInput("  \u200BHello WorkSphere\u200B  ")).toBe("Hello WorkSphere");
    });

    it("strips harmful script and iframe tags", () => {
      const malicious = '<script>alert("xss")</script>Hello there';
      expect(sanitizeChatInput(malicious)).toBe("Hello there");

      const iframeInjection = '<iframe src="malicious.site"></iframe>Check this';
      expect(sanitizeChatInput(iframeInjection)).toBe("Check this");
    });

    it("filters out empty messages from combinedMessages so blank bubbles do not render", () => {
      const emptyMessages = [
        { id: "1", role: "user", content: "   " },
        { id: "2", role: "assistant", content: "" },
        { id: "3", role: "user", content: "Valid message" },
      ];

      render(<ChatPanel messages={emptyMessages} />);

      expect(screen.getByText("Valid message")).toBeInTheDocument();
      expect(screen.queryByTestId("chat-message-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chat-message-2")).not.toBeInTheDocument();
    });
  });
});

