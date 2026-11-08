import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BrainTerminal } from "@/components/chat/BrainTerminal";

// Mock framer-motion to avoid animation timing issues in test environment
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("BrainTerminal command input and history buffer (#6051)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders terminal command input and submit button", () => {
    render(<BrainTerminal isOpen={true} />);

    expect(screen.getByTestId("terminal-command-input")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-submit-btn")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-submit-btn")).toBeDisabled();
  });

  it("disables submit action while input is empty or contains whitespace only", () => {
    const handleCommand = jest.fn();
    render(<BrainTerminal isOpen={true} onCommand={handleCommand} />);

    const input = screen.getByTestId("terminal-command-input");
    const submitBtn = screen.getByTestId("terminal-submit-btn");

    expect(submitBtn).toBeDisabled();

    // Type whitespace only
    fireEvent.change(input, { target: { value: "   " } });
    expect(submitBtn).toBeDisabled();

    // Press Enter with whitespace only
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(screen.getByTestId("terminal-command-form"));

    expect(handleCommand).not.toHaveBeenCalled();
    expect(submitBtn).toBeDisabled();
  });

  it("immediately clears input field upon Enter key press and submission", () => {
    const handleCommand = jest.fn();
    const handleSubmitCommand = jest.fn();
    render(
      <BrainTerminal
        isOpen={true}
        onCommand={handleCommand}
        onSubmitCommand={handleSubmitCommand}
      />,
    );

    const input = screen.getByTestId("terminal-command-input") as HTMLInputElement;
    const submitBtn = screen.getByTestId("terminal-submit-btn");

    fireEvent.change(input, { target: { value: "scan venue noise" } });
    expect(input.value).toBe("scan venue noise");
    expect(submitBtn).toBeEnabled();

    // Press Enter to submit
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(screen.getByTestId("terminal-command-form"));

    // Input must be instantly cleared to empty
    expect(input.value).toBe("");
    expect(submitBtn).toBeDisabled();

    expect(handleCommand).toHaveBeenCalledWith("scan venue noise");
    expect(handleSubmitCommand).toHaveBeenCalledWith("scan venue noise");

    // Command should also be appended to terminal logs
    expect(screen.getByText("scan venue noise")).toBeInTheDocument();
  });

  it("preserves submitted command in history buffer for recall via ArrowUp and ArrowDown", () => {
    render(<BrainTerminal isOpen={true} />);

    const input = screen.getByTestId("terminal-command-input") as HTMLInputElement;
    const form = screen.getByTestId("terminal-command-form");

    // Submit first command
    fireEvent.change(input, { target: { value: "first-command" } });
    fireEvent.submit(form);
    expect(input.value).toBe("");

    // Submit second command
    fireEvent.change(input, { target: { value: "second-command" } });
    fireEvent.submit(form);
    expect(input.value).toBe("");

    // Type draft text without submitting
    fireEvent.change(input, { target: { value: "my-current-draft" } });

    // Press ArrowUp: recall most recent command
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("second-command");

    // Press ArrowUp again: recall older command
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("first-command");

    // Press ArrowUp at oldest history boundary: stays at first-command
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("first-command");

    // Press ArrowDown: move to newer command
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("second-command");

    // Press ArrowDown past newest command: restores draft text
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("my-current-draft");
  });

  it("closes terminal when Escape key is pressed", () => {
    const handleClose = jest.fn();
    render(<BrainTerminal isOpen={true} onClose={handleClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
