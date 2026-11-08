import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ClusterBadge } from "@/components/ClusterBadge";

describe("ClusterBadge Component (#6911)", () => {
  it("renders default fallback state when no props are passed", () => {
    render(<ClusterBadge />);

    const badge = screen.getByTestId("cluster-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("role", "status");
    expect(screen.getByTestId("cluster-badge-icon")).toBeInTheDocument();
    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Match");
  });

  it("renders 'Top Match' when score is >= 0.9", () => {
    render(<ClusterBadge score={0.94} />);

    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Top Match");
  });

  it("renders 'Great Match' when score is between 0.8 and 0.9", () => {
    render(<ClusterBadge score={0.85} />);

    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Great Match");
  });

  it("renders 'Good Match' when score is between 0.6 and 0.8", () => {
    render(<ClusterBadge score={0.68} />);

    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Good Match");
  });

  it("renders 'Match' when score is below 0.6", () => {
    render(<ClusterBadge score={0.45} />);

    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Match");
  });

  it("normalizes percentage scores > 1 (e.g. 95 -> 0.95)", () => {
    const { rerender } = render(<ClusterBadge score={95} />);
    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Top Match");

    rerender(<ClusterBadge score={84} />);
    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Great Match");

    rerender(<ClusterBadge score={65} />);
    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Good Match");
  });

  it("handles non-finite and negative score values gracefully", () => {
    const { rerender } = render(<ClusterBadge score={NaN} />);
    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Match");

    rerender(<ClusterBadge score={-0.5} />);
    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Match");

    rerender(<ClusterBadge score={Infinity} />);
    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Match");
  });

  it("renders cluster label when score is missing but cluster is provided", () => {
    render(<ClusterBadge cluster={3} />);

    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Cluster 3");
  });

  it("renders cluster prefix when showCluster is true", () => {
    render(<ClusterBadge cluster={7} score={0.88} showCluster={true} />);

    expect(screen.getByTestId("cluster-badge-cluster")).toHaveTextContent("C7:");
    expect(screen.getByTestId("cluster-badge-label")).toHaveTextContent("Great Match");
  });

  it("renders percentage score when showScore is true", () => {
    render(<ClusterBadge score={0.92} showScore={true} />);

    expect(screen.getByTestId("cluster-badge-score")).toHaveTextContent("(92%)");
  });

  it("includes cluster, label, and score in title and aria-label", () => {
    render(<ClusterBadge cluster={2} score={0.91} />);

    const badge = screen.getByTestId("cluster-badge");
    const expectedTooltip = "Cluster 2 • Top Match • (91%)";
    expect(badge).toHaveAttribute("title", expectedTooltip);
    expect(badge).toHaveAttribute("aria-label", expectedTooltip);
  });

  it("applies custom className prop", () => {
    render(<ClusterBadge className="custom-test-badge ml-4" />);

    const badge = screen.getByTestId("cluster-badge");
    expect(badge).toHaveClass("custom-test-badge", "ml-4");
  });

  it("calls onClick callback when clicked", () => {
    const mockOnClick = jest.fn();
    render(<ClusterBadge onClick={mockOnClick} />);

    const badge = screen.getByTestId("cluster-badge");
    expect(badge).toHaveClass("cursor-pointer");

    fireEvent.click(badge);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });
});
