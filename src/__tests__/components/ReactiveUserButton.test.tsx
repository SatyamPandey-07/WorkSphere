import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ReactiveUserButton } from "@/components/auth/ReactiveUserButton";
import { dispatchAvatarUpdated } from "@/lib/avatar-events";

describe("ReactiveUserButton Component", () => {
  it("renders initials fallback when initialAvatarUrl is missing", () => {
    render(
      <ReactiveUserButton
        userId="user_1"
        userName="Jane Doe"
        initialAvatarUrl={null}
      />,
    );

    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Open profile menu for Jane Doe",
    );
    expect(screen.getByText("JA")).toBeInTheDocument();
  });

  it("renders image when initialAvatarUrl is provided", () => {
    render(
      <ReactiveUserButton
        userId="user_1"
        userName="Jane Doe"
        initialAvatarUrl="https://example.com/avatar.jpg"
      />,
    );

    const img = screen.getByRole("img", { name: "Jane Doe" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/avatar.jpg");
  });

  it("updates avatar image reactively upon dispatchAvatarUpdated without page reload", () => {
    render(
      <ReactiveUserButton
        userId="user_target"
        userName="Target User"
        initialAvatarUrl="https://example.com/old.jpg"
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://example.com/old.jpg",
    );

    act(() => {
      dispatchAvatarUpdated("user_target", "https://example.com/new.jpg");
    });

    const updatedImg = screen.getByRole("img", { name: "Target User" });
    expect(updatedImg).toHaveAttribute("src", "https://example.com/new.jpg");
  });

  it("ignores avatar update events targeting a different userId", () => {
    render(
      <ReactiveUserButton
        userId="user_me"
        userName="Current User"
        initialAvatarUrl="https://example.com/mine.jpg"
      />,
    );

    act(() => {
      dispatchAvatarUpdated("user_other", "https://example.com/other.jpg");
    });

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://example.com/mine.jpg",
    );
  });
});
