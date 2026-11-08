import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemberSinceBadge } from "@/components/MemberSinceBadge";

describe("MemberSinceBadge", () => {
  it("shows the formatted join date", () => {
    render(<MemberSinceBadge createdAt={new Date("2025-10-15T12:00:00Z")} />);
    expect(screen.getByTestId("member-since-badge")).toHaveTextContent(
      "Member since October 2025",
    );
  });

  it("renders nothing when the date is missing", () => {
    const { container } = render(<MemberSinceBadge createdAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the date is invalid", () => {
    const { container } = render(<MemberSinceBadge createdAt="nope" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders with accessible title attribute containing the full membership string", () => {
    render(<MemberSinceBadge createdAt={new Date("2024-09-01T00:00:00Z")} />);
    const badge = screen.getByTestId("member-since-badge");
    expect(badge).toHaveAttribute("title", "Member since September 2024");
  });

  it("applies truncation, text-ellipsis, and overflow-hidden styling to the member duration text", () => {
    render(<MemberSinceBadge createdAt={new Date("2024-09-01T00:00:00Z")} />);
    const badge = screen.getByTestId("member-since-badge");
    const textSpan = badge.querySelector("span");
    expect(textSpan).not.toBeNull();
    expect(textSpan).toHaveClass("truncate");
    expect(textSpan).toHaveClass("whitespace-nowrap");
    expect(textSpan).toHaveClass("overflow-hidden");
    expect(textSpan).toHaveClass("text-ellipsis");
  });

  it("ensures badge icon preserves alignment with shrink-0", () => {
    render(<MemberSinceBadge createdAt={new Date("2024-09-01T00:00:00Z")} />);
    const badge = screen.getByTestId("member-since-badge");
    const icon = badge.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("shrink-0");
  });

  it("gracefully fits inside narrow mobile viewports (320px–375px)", () => {
    const { container } = render(
      <div style={{ width: "320px" }}>
        <MemberSinceBadge createdAt={new Date("2024-09-01T00:00:00Z")} />
      </div>,
    );
    const badge = screen.getByTestId("member-since-badge");
    expect(badge).toHaveClass("max-w-full");
    expect(container).toHaveTextContent("Member since September 2024");
  });

  it("renders custom title override when passed", () => {
    render(
      <MemberSinceBadge
        createdAt={new Date("2024-09-01T00:00:00Z")}
        title="Custom Membership Title"
      />,
    );
    expect(screen.getByTestId("member-since-badge")).toHaveAttribute(
      "title",
      "Custom Membership Title",
    );
  });
});
