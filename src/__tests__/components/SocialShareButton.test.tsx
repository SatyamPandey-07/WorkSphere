import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  SocialShareButton,
  copyShareableLinkToClipboard,
} from "@/components/social/SocialShareButton";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("SocialShareButton component (#3467)", () => {
  const originalClipboard = navigator.clipboard;
  const mockWriteText = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  it("renders with default label 'Share Session' and link icon", () => {
    render(<SocialShareButton />);

    const button = screen.getByTestId("share-session-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Share Session");
    expect(button).toHaveAttribute("aria-label", "Share Session");
    expect(screen.getByTestId("share-icon-link")).toBeInTheDocument();
  });

  it("copies window.location.href to clipboard on click and triggers success toast", async () => {
    render(<SocialShareButton />);

    const button = screen.getByTestId("share-session-button");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockWriteText).toHaveBeenCalledWith(window.location.href);
    expect(mockToast).toHaveBeenCalledWith(
      "Session link copied to clipboard! 📋",
      "success",
    );
  });

  it("copies custom url prop when provided", async () => {
    const customUrl = "https://worksphere.com/social/sessions/focus-room-42";
    render(<SocialShareButton url={customUrl} />);

    const button = screen.getByTestId("share-session-button");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockWriteText).toHaveBeenCalledWith(customUrl);
    expect(mockToast).toHaveBeenCalledWith(
      "Session link copied to clipboard! 📋",
      "success",
    );
  });

  it("displays visual copied feedback and calls onCopy callback", async () => {
    jest.useFakeTimers();
    const onCopy = jest.fn();
    render(<SocialShareButton onCopy={onCopy} />);

    const button = screen.getByTestId("share-session-button");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(onCopy).toHaveBeenCalledWith(window.location.href);
    expect(button).toHaveTextContent("Copied!");
    expect(screen.getByTestId("share-icon-check")).toBeInTheDocument();

    // Fast forward 2.5s timer
    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(button).toHaveTextContent("Share Session");
    expect(screen.getByTestId("share-icon-link")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("uses textarea fallback when navigator.clipboard is unavailable", async () => {
    // Remove navigator.clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const mockExecCommand = jest.fn().mockReturnValue(true);
    document.execCommand = mockExecCommand;

    const testUrl = "https://worksphere.com/social/sessions/fallback-room";
    render(<SocialShareButton url={testUrl} />);

    const button = screen.getByTestId("share-session-button");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockExecCommand).toHaveBeenCalledWith("copy");
    expect(mockToast).toHaveBeenCalledWith(
      "Session link copied to clipboard! 📋",
      "success",
    );
  });

  it("copyShareableLinkToClipboard helper returns true on successful clipboard write", async () => {
    const result = await copyShareableLinkToClipboard("https://worksphere.com/session/1");
    expect(result).toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith("https://worksphere.com/session/1");
  });

  describe("tooltip responsive positioning (#5022)", () => {
    it("renders tooltip with responsive boundary alignment right-0 sm:left-1/2", () => {
      render(<SocialShareButton />);

      const tooltip = screen.getByTestId("share-tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveAttribute("role", "tooltip");
      expect(tooltip).toHaveTextContent("Share session link");

      // Verify responsive classes preventing clipping on right edge of mobile screens
      expect(tooltip.className).toContain("right-0");
      expect(tooltip.className).toContain("sm:left-1/2");
      expect(tooltip.className).toContain("translate-x-0");
      expect(tooltip.className).toContain("sm:-translate-x-1/2");
    });

    it("renders custom tooltip text and updates when copied", async () => {
      render(
        <SocialShareButton
          tooltipText="Copy invite link"
          copiedLabel="Link ready!"
        />,
      );

      const tooltip = screen.getByTestId("share-tooltip");
      expect(tooltip).toHaveTextContent("Copy invite link");

      const button = screen.getByTestId("share-session-button");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(tooltip).toHaveTextContent("Link ready!");
    });
  });

  describe("Native Web Share API on mobile / supported devices", () => {
    const originalShare = navigator.share;
    const originalCanShare = navigator.canShare;
    const mockShare = jest.fn();

    beforeEach(() => {
      mockShare.mockResolvedValue(undefined);
      Object.defineProperty(navigator, "share", {
        value: mockShare,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(navigator, "share", {
        value: originalShare,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "canShare", {
        value: originalCanShare,
        writable: true,
        configurable: true,
      });
    });

    it("invokes navigator.share with default metadata when available", async () => {
      const onCopy = jest.fn();
      render(<SocialShareButton onCopy={onCopy} />);

      const button = screen.getByTestId("share-session-button");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(mockShare).toHaveBeenCalledWith({
        title: "WorkSphere Focus Session",
        text: "Join my collaborative session on WorkSphere!",
        url: window.location.href,
      });
      expect(onCopy).toHaveBeenCalledWith(window.location.href);
      expect(mockWriteText).not.toHaveBeenCalled();
    });

    it("invokes navigator.share with custom title, text, and url", async () => {
      render(
        <SocialShareButton
          url="https://worksphere.com/sessions/deep-work"
          title="Custom Session Title"
          text="Join my deep work sprint!"
        />,
      );

      const button = screen.getByTestId("share-session-button");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(mockShare).toHaveBeenCalledWith({
        title: "Custom Session Title",
        text: "Join my deep work sprint!",
        url: "https://worksphere.com/sessions/deep-work",
      });
    });

    it("handles user cancellation (AbortError) without triggering fallback copy or error toast", async () => {
      const abortError = new Error("Share cancelled");
      abortError.name = "AbortError";
      mockShare.mockRejectedValue(abortError);

      render(<SocialShareButton />);

      const button = screen.getByTestId("share-session-button");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(mockShare).toHaveBeenCalled();
      expect(mockWriteText).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("falls back to clipboard copy when navigator.share throws a non-abort error", async () => {
      const shareError = new Error("Permission denied");
      shareError.name = "NotAllowedError";
      mockShare.mockRejectedValue(shareError);

      render(<SocialShareButton />);

      const button = screen.getByTestId("share-session-button");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(mockShare).toHaveBeenCalled();
      expect(mockWriteText).toHaveBeenCalledWith(window.location.href);
      expect(mockToast).toHaveBeenCalledWith(
        "Session link copied to clipboard! 📋",
        "success",
      );
    });

    it("falls back to clipboard copy when navigator.canShare returns false", async () => {
      Object.defineProperty(navigator, "canShare", {
        value: jest.fn().mockReturnValue(false),
        writable: true,
        configurable: true,
      });

      render(<SocialShareButton />);

      const button = screen.getByTestId("share-session-button");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(mockShare).not.toHaveBeenCalled();
      expect(mockWriteText).toHaveBeenCalledWith(window.location.href);
      expect(mockToast).toHaveBeenCalledWith(
        "Session link copied to clipboard! 📋",
        "success",
      );
    });
  });
});
