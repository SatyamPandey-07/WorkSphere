import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CopyToClipboardButton } from "@/components/ui/CopyToClipboardButton";

describe("CopyToClipboardButton", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.assign(navigator, { clipboard: originalClipboard });
    jest.restoreAllMocks();
  });

  it("renders with default label and title", () => {
    render(<CopyToClipboardButton textToCopy="123 Main St, New York, NY" />);

    const button = screen.getByRole("button", { name: /copy to clipboard/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByText("Copy Address")).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "Copy to clipboard");
  });

  it("renders with custom label", () => {
    render(
      <CopyToClipboardButton
        textToCopy="123 Main St, New York, NY"
        label="Copy Location"
      />,
    );

    expect(screen.getByText("Copy Location")).toBeInTheDocument();
  });

  it("copies text using navigator.clipboard.writeText and shows checkmark and toast", async () => {
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(<CopyToClipboardButton textToCopy="456 Elm St, San Francisco, CA" />);

    const button = screen.getByRole("button", { name: /copy to clipboard/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockWriteText).toHaveBeenCalledWith("456 Elm St, San Francisco, CA");
    expect(screen.getByText("Copied!")).toBeInTheDocument();

    const toast = screen.getByRole("status");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("Address copied!");
  });

  it("reverts checkmark and hides toast after 2 seconds (2000 ms)", async () => {
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(<CopyToClipboardButton textToCopy="789 Broadway, Seattle, WA" />);

    const button = screen.getByRole("button", { name: /copy to clipboard/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByText("Copied!")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Advance timers by 2000ms
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText("Copy Address")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to document.execCommand when navigator.clipboard is not available", async () => {
    Object.assign(navigator, { clipboard: undefined });
    const execCommandMock = jest.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    render(<CopyToClipboardButton textToCopy="Fallback Address 101" />);

    const button = screen.getByRole("button", { name: /copy to clipboard/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(screen.getByText("Copied!")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Address copied!");
  });

  it("handles navigator.clipboard.writeText failure gracefully by using fallback", async () => {
    const mockWriteText = jest
      .fn()
      .mockRejectedValue(new Error("Permission denied"));
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });
    const execCommandMock = jest.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(<CopyToClipboardButton textToCopy="Error Fallback St" />);

    const button = screen.getByRole("button", { name: /copy to clipboard/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockWriteText).toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(screen.getByText("Copied!")).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it("stops click propagation so parent click handlers are not triggered", async () => {
    const parentClick = jest.fn();
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <div onClick={parentClick}>
        <CopyToClipboardButton textToCopy="Parent Safe St" />
      </div>,
    );

    const button = screen.getByRole("button", { name: /copy to clipboard/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(parentClick).not.toHaveBeenCalled();
    expect(mockWriteText).toHaveBeenCalledWith("Parent Safe St");
  });

  it("supports custom toast message", async () => {
    const mockWriteText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <CopyToClipboardButton
        textToCopy="Custom Toast Ave"
        toastMessage="Venue address saved!"
      />,
    );

    const button = screen.getByRole("button", { name: /copy to clipboard/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Venue address saved!");
  });
});
