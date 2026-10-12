
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React, { useState } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";

jest.mock("@/lib/chatSound", () => ({
  playChatMessageSound: jest.fn(),
  isChatSoundEnabled: jest.fn(() => false),
}));

function ControlledChatPanel({ initialInput = "" }: { initialInput?: string }) {
  const [input, setInput] = useState(initialInput);

  return (
    <ChatPanel
      input={input}
      onInputChange={setInput}
      onSubmit={(e) => e.preventDefault()}
    />
  );
}

describe("ChatPanel character counter", () => {
  it("does not display the counter at 400 characters", () => {
    render(<ControlledChatPanel initialInput={"a".repeat(400)} />);

    expect(screen.queryByTestId("character-counter")).not.toBeInTheDocument();
  });

  it("displays the counter when input exceeds 400 characters", () => {
    render(<ControlledChatPanel initialInput={"a".repeat(450)} />);

    expect(screen.getByTestId("character-counter")).toHaveTextContent("450 / 500");
  });

  it("uses amber styling at 480 characters", () => {
    render(<ControlledChatPanel initialInput={"a".repeat(480)} />);

    expect(screen.getByTestId("character-counter")).toHaveTextContent("480 / 500");
    expect(screen.getByTestId("character-counter")).toHaveClass("text-amber-600");
  });

  it("uses red styling at 500 characters", () => {
    render(<ControlledChatPanel initialInput={"a".repeat(500)} />);

    expect(screen.getByTestId("character-counter")).toHaveTextContent("500 / 500");
    expect(screen.getByTestId("character-counter")).toHaveClass("text-red-600");
  });

  it("limits the input to 500 characters when typing or pasting", () => {
    render(<ControlledChatPanel />);

    const input = screen.getByPlaceholderText("Type a message...") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "a".repeat(501) } });

    expect(input).toHaveAttribute("maxLength", "500");
    expect(input).toHaveValue("a".repeat(500));
    expect(screen.getByTestId("character-counter")).toHaveTextContent("500 / 500");
  });
});
