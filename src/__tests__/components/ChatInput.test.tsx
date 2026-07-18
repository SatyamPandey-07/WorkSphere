import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "@/components/chat/ChatMessages";
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("ChatInput recent searches history", () => {
  const mockOnInputChange = jest.fn();
  const mockOnSubmit = jest.fn();

  beforeEach(() => {
    mockOnInputChange.mockClear();
    mockOnSubmit.mockClear();
    localStorage.clear();
  });

  it("renders input field correctly", () => {
    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    expect(inputEl).toBeInTheDocument();
  });

  it("does not display recent searches panel when focused if history is empty", () => {
    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    fireEvent.focus(inputEl);

    expect(screen.queryByText("Recent Searches")).not.toBeInTheDocument();
  });

  it("displays recent searches panel when focused if history has entries", () => {
    localStorage.setItem(
      "ws-recent-searches",
      JSON.stringify(["quiet cafe", "coworking space"]),
    );

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    fireEvent.focus(inputEl);

    expect(screen.getByText("Recent Searches")).toBeInTheDocument();
    expect(screen.getByText("quiet cafe")).toBeInTheDocument();
    expect(screen.getByText("coworking space")).toBeInTheDocument();
  });

  it("adds query to localStorage on submit", () => {
    render(
      <ChatInput
        input="starbucks wifi"
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const form = screen.getByRole("button").closest("form");
    expect(form).toBeInTheDocument();
    fireEvent.submit(form!);

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);

    const stored = JSON.parse(
      localStorage.getItem("ws-recent-searches") || "[]",
    );
    expect(stored).toContain("starbucks wifi");
  });

  it("calls onInputChange with search term on chip mouse down", () => {
    localStorage.setItem(
      "ws-recent-searches",
      JSON.stringify(["library outlets"]),
    );

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    fireEvent.focus(inputEl);

    const chip = screen.getByText("library outlets");
    fireEvent.mouseDown(chip);

    expect(mockOnInputChange).toHaveBeenCalledWith("library outlets");
  });

  it("clears history when clear is clicked", () => {
    localStorage.setItem("ws-recent-searches", JSON.stringify(["old search"]));

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    fireEvent.focus(inputEl);

    const clearBtn = screen.getByText("Clear");
    fireEvent.mouseDown(clearBtn);

    expect(localStorage.getItem("ws-recent-searches")).toBeNull();
    expect(screen.queryByText("Recent Searches")).not.toBeInTheDocument();
  });
});
