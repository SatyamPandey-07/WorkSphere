import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CopyBookingReferenceButton } from "@/components/bookings/CopyBookingReferenceButton";
import RootCopyBookingReferenceButton from "@/components/CopyBookingReferenceButton";

describe("CopyBookingReferenceButton Component (#6921)", () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
    document.execCommand = jest.fn().mockReturnValue(true);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
    document.execCommand = originalExecCommand;
  });

  it("renders with default props and attributes", () => {
    render(<CopyBookingReferenceButton referenceId="WS-REF123" />);

    const button = screen.getByTestId("copy-booking-reference-btn");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute(
      "aria-label",
      "Copy booking confirmation reference ID WS-REF123"
    );
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId("copy-reference-id-text")).not.toBeInTheDocument();
  });

  it("renders custom label and inline reference ID when showId is true", () => {
    render(
      <CopyBookingReferenceButton
        referenceId="WS-CONFIRM456"
        label="Copy Code"
        showId={true}
        className="custom-copy-btn"
        testId="custom-btn-id"
      />
    );

    const button = screen.getByTestId("custom-btn-id");
    expect(button).toHaveClass("custom-copy-btn");
    expect(screen.getByTestId("copy-reference-label-text")).toHaveTextContent("Copy Code");
    expect(screen.getByTestId("copy-reference-id-text")).toHaveTextContent("WS-CONFIRM456");
  });

  it("copies to clipboard and triggers onCopied callback", async () => {
    const handleCopied = jest.fn();
    render(
      <CopyBookingReferenceButton
        referenceId="WS-BOOK789"
        onCopied={handleCopied}
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("WS-BOOK789");
    expect(handleCopied).toHaveBeenCalledWith("WS-BOOK789");
    expect(screen.getByTestId("copy-sr-announcement")).toHaveTextContent(
      "Booking reference copied to clipboard"
    );
    expect(button).toHaveAttribute(
      "aria-label",
      "Booking reference ID WS-BOOK789 copied to clipboard"
    );

    // Fast-forward successDuration (default 2000ms)
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(button).toHaveAttribute(
      "aria-label",
      "Copy booking confirmation reference ID WS-BOOK789"
    );
  });

  it("supports custom successDuration", async () => {
    render(
      <CopyBookingReferenceButton
        referenceId="WS-FAST"
        successDuration={1000}
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toHaveAttribute(
      "aria-label",
      "Booking reference ID WS-FAST copied to clipboard"
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(button).toHaveAttribute(
      "aria-label",
      "Copy booking confirmation reference ID WS-FAST"
    );
  });

  it("uses fallback execCommand copy when navigator.clipboard is unavailable", async () => {
    Object.assign(navigator, { clipboard: undefined });
    const handleCopied = jest.fn();

    render(
      <CopyBookingReferenceButton
        referenceId="WS-FALLBACK1"
        onCopied={handleCopied}
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(handleCopied).toHaveBeenCalledWith("WS-FALLBACK1");
  });

  it("falls back to execCommand when navigator.clipboard.writeText rejects", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("Permission denied")),
      },
    });
    const handleCopied = jest.fn();

    render(
      <CopyBookingReferenceButton
        referenceId="WS-FALLBACK2"
        onCopied={handleCopied}
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(handleCopied).toHaveBeenCalledWith("WS-FALLBACK2");
  });

  it("invokes onError callback when fallback copy throws", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("Permission denied")),
      },
    });
    document.execCommand = jest.fn().mockImplementation(() => {
      throw new Error("execCommand failed");
    });
    const handleError = jest.fn();

    render(
      <CopyBookingReferenceButton
        referenceId="WS-ERROR"
        onError={handleError}
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(handleError).toHaveBeenCalled();
  });

  it("does not copy or set state if referenceId is empty or whitespace", async () => {
    const handleCopied = jest.fn();
    render(
      <CopyBookingReferenceButton
        referenceId="   "
        onCopied={handleCopied}
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(handleCopied).not.toHaveBeenCalled();
  });

  it("disables button and suppresses interaction when disabled is true", async () => {
    const handleCopied = jest.fn();
    render(
      <CopyBookingReferenceButton
        referenceId="WS-DISABLED"
        disabled={true}
        onCopied={handleCopied}
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    // Hover should not reveal tooltip when disabled
    fireEvent.mouseEnter(button);
    expect(screen.queryByTestId("copy-reference-tooltip")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(handleCopied).not.toHaveBeenCalled();
  });

  it("shows tooltip on hover and focus, and hides on leave and blur", () => {
    render(
      <CopyBookingReferenceButton
        referenceId="WS-TOOLTIP"
        tooltipText="Copy my code"
        copiedTooltipText="Done copying"
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");

    // Initially no tooltip
    expect(screen.queryByTestId("copy-reference-tooltip")).not.toBeInTheDocument();

    // Hover reveals tooltip
    fireEvent.mouseEnter(button);
    expect(screen.getByTestId("copy-reference-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("copied-tooltip-text")).toHaveTextContent("Copy my code");

    // Mouse leave hides tooltip
    fireEvent.mouseLeave(button);
    expect(screen.queryByTestId("copy-reference-tooltip")).not.toBeInTheDocument();

    // Focus reveals tooltip
    fireEvent.focus(button);
    expect(screen.getByTestId("copy-reference-tooltip")).toBeInTheDocument();

    // Blur hides tooltip
    fireEvent.blur(button);
    expect(screen.queryByTestId("copy-reference-tooltip")).not.toBeInTheDocument();
  });

  it("applies positioning classes based on tooltipPosition", () => {
    const { rerender } = render(
      <CopyBookingReferenceButton
        referenceId="WS-POS"
        tooltipPosition="bottom"
      />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");
    fireEvent.mouseEnter(button);
    let tooltip = screen.getByTestId("copy-reference-tooltip");
    expect(tooltip).toHaveClass("top-full");

    rerender(
      <CopyBookingReferenceButton
        referenceId="WS-POS"
        tooltipPosition="left"
      />
    );
    fireEvent.mouseEnter(button);
    tooltip = screen.getByTestId("copy-reference-tooltip");
    expect(tooltip).toHaveClass("right-full");

    rerender(
      <CopyBookingReferenceButton
        referenceId="WS-POS"
        tooltipPosition="right"
      />
    );
    fireEvent.mouseEnter(button);
    tooltip = screen.getByTestId("copy-reference-tooltip");
    expect(tooltip).toHaveClass("left-full");
  });

  it("safely ignores timeout execution after unmounting", async () => {
    const { unmount } = render(
      <CopyBookingReferenceButton referenceId="WS-UNMOUNT" />
    );

    const button = screen.getByTestId("copy-booking-reference-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    unmount();

    // Fast forward should not trigger errors on unmounted component
    act(() => {
      jest.advanceTimersByTime(2500);
    });
  });

  it("works seamlessly through root re-export component", () => {
    render(<RootCopyBookingReferenceButton referenceId="WS-ROOT" />);
    expect(screen.getByTestId("copy-booking-reference-btn")).toBeInTheDocument();
  });
});
