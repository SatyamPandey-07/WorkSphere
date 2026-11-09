import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RecommendedBadge } from "@/components/RecommendedBadge";

describe("RecommendedBadge Component (#6913)", () => {
  it("renders default badge with icon, label, title and aria-label", () => {
    render(<RecommendedBadge />);

    const badge = screen.getByTestId("recommended-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("role", "status");
    expect(badge).toHaveAttribute("title", "Recommended for You");
    expect(badge).toHaveAttribute("aria-label", "Recommended for You");

    expect(screen.getByTestId("recommended-badge-icon")).toBeInTheDocument();
    expect(screen.getByTestId("recommended-badge-label")).toHaveTextContent("Recommended for You");
  });

  it("renders compact mode with 'Recommended' label", () => {
    render(<RecommendedBadge compact={true} />);

    const badge = screen.getByTestId("recommended-badge");
    expect(badge).toHaveAttribute("title", "Recommended");
    expect(badge).toHaveAttribute("aria-label", "Recommended");
    expect(screen.getByTestId("recommended-badge-label")).toHaveTextContent("Recommended");
  });

  it("renders custom label prop overriding defaults", () => {
    render(<RecommendedBadge label="Editor's Choice" compact={true} />);

    const badge = screen.getByTestId("recommended-badge");
    expect(badge).toHaveAttribute("title", "Editor's Choice");
    expect(badge).toHaveAttribute("aria-label", "Editor's Choice");
    expect(screen.getByTestId("recommended-badge-label")).toHaveTextContent("Editor's Choice");
  });

  it("hides icon when showIcon is false", () => {
    render(<RecommendedBadge showIcon={false} />);

    expect(screen.queryByTestId("recommended-badge-icon")).not.toBeInTheDocument();
    expect(screen.getByTestId("recommended-badge-label")).toHaveTextContent("Recommended for You");
  });

  it("applies custom className prop", () => {
    render(<RecommendedBadge className="my-custom-badge-class mr-2" />);

    const badge = screen.getByTestId("recommended-badge");
    expect(badge).toHaveClass("my-custom-badge-class", "mr-2");
  });

  it("fires onClick callback when clicked", () => {
    const mockOnClick = jest.fn();
    render(<RecommendedBadge onClick={mockOnClick} />);

    const badge = screen.getByTestId("recommended-badge");
    expect(badge).toHaveClass("cursor-pointer");

    fireEvent.click(badge);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });
});
