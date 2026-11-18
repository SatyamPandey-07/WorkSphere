import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ChatTimestampFormatToggle } from "@/components/settings/ChatTimestampFormatToggle";
import {
  CHAT_TIMESTAMP_FORMAT_STORAGE_KEY,
  CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT,
  getChatTimestampFormat,
  setChatTimestampFormat,
} from "@/lib/chatTimestamps";

describe("ChatTimestampFormatToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders with default relative format and aria-pressed attributes", () => {
    render(<ChatTimestampFormatToggle />);

    const container = screen.getByTestId("chat-timestamp-format-toggle");
    expect(container).toBeInTheDocument();

    const relativeBtn = screen.getByTestId("timestamp-format-relative");
    const exactBtn = screen.getByTestId("timestamp-format-exact");

    expect(relativeBtn).toHaveAttribute("aria-pressed", "true");
    expect(exactBtn).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Chat timestamps")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Chat timestamp format" })).toBeInTheDocument();
    expect(screen.getByTestId("timestamp-preview-chip")).toBeInTheDocument();
  });

  it("initializes with stored format if set in localStorage", () => {
    localStorage.setItem(CHAT_TIMESTAMP_FORMAT_STORAGE_KEY, "exact");

    render(<ChatTimestampFormatToggle />);

    const relativeBtn = screen.getByTestId("timestamp-format-relative");
    const exactBtn = screen.getByTestId("timestamp-format-exact");

    expect(relativeBtn).toHaveAttribute("aria-pressed", "false");
    expect(exactBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("switches format on click, invokes onFormatChange, and updates storage", () => {
    const handleFormatChange = jest.fn();
    render(<ChatTimestampFormatToggle onFormatChange={handleFormatChange} />);

    const exactBtn = screen.getByTestId("timestamp-format-exact");
    fireEvent.click(exactBtn);

    expect(exactBtn).toHaveAttribute("aria-pressed", "true");
    expect(handleFormatChange).toHaveBeenCalledWith("exact");
    expect(localStorage.getItem(CHAT_TIMESTAMP_FORMAT_STORAGE_KEY)).toBe("exact");

    const relativeBtn = screen.getByTestId("timestamp-format-relative");
    fireEvent.click(relativeBtn);

    expect(relativeBtn).toHaveAttribute("aria-pressed", "true");
    expect(handleFormatChange).toHaveBeenCalledWith("relative");
    expect(localStorage.getItem(CHAT_TIMESTAMP_FORMAT_STORAGE_KEY)).toBe("relative");
  });

  it("updates format when CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT is dispatched", () => {
    const handleFormatChange = jest.fn();
    render(<ChatTimestampFormatToggle onFormatChange={handleFormatChange} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT, { detail: "exact" }),
      );
    });

    const exactBtn = screen.getByTestId("timestamp-format-exact");
    expect(exactBtn).toHaveAttribute("aria-pressed", "true");
    expect(handleFormatChange).toHaveBeenCalledWith("exact");
  });

  it("removes event listener on unmount", () => {
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = render(<ChatTimestampFormatToggle />);

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      CHAT_TIMESTAMP_FORMAT_CHANGE_EVENT,
      expect.any(Function),
    );
  });

  it("applies custom className to container", () => {
    render(<ChatTimestampFormatToggle className="custom-test-class" />);
    const container = screen.getByTestId("chat-timestamp-format-toggle");
    expect(container).toHaveClass("custom-test-class");
  });
});
