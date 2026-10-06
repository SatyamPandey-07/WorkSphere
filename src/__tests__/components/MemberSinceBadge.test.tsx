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
});
