import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderSanitizedBioText } from "@/components/social/NomadSkillBarterBoard";

describe("NomadSkillBarterBoard bio and skill description sanitization", () => {
  it("returns null when text is empty, null or undefined", () => {
    expect(renderSanitizedBioText("")).toBeNull();
    expect(renderSanitizedBioText(null)).toBeNull();
    expect(renderSanitizedBioText(undefined)).toBeNull();
  });

  it("renders plain text without links safely", () => {
    render(<div data-testid="bio">{renderSanitizedBioText("Full stack developer offering React mentoring")}</div>);
    const container = screen.getByTestId("bio");
    expect(container).toHaveTextContent("Full stack developer offering React mentoring");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("escapes raw HTML tags to prevent XSS script injection", () => {
    const maliciousPayload = "<script>alert('xss')</script><img src=x onerror=alert(1)> Senior Dev";
    render(<div data-testid="bio">{renderSanitizedBioText(maliciousPayload)}</div>);

    const container = screen.getByTestId("bio");
    // Verify script tags are rendered as plain text strings and not executable DOM nodes
    expect(container).toHaveTextContent("<script>alert('xss')</script><img src=x onerror=alert(1)> Senior Dev");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("automatically parses http and https URLs into safe anchor links with target='_blank' and rel='noopener noreferrer'", () => {
    const textWithUrls = "Check out my portfolio at https://alexdev.io and github https://github.com/alex for code samples";
    render(<div data-testid="bio">{renderSanitizedBioText(textWithUrls)}</div>);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);

    expect(links[0]).toHaveAttribute("href", "https://alexdev.io");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[0]).toHaveTextContent("https://alexdev.io");

    expect(links[1]).toHaveAttribute("href", "https://github.com/alex");
    expect(links[1]).toHaveAttribute("target", "_blank");
    expect(links[1]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[1]).toHaveTextContent("https://github.com/alex");
  });

  it("auto-links www-prefixed URLs with secure https:// scheme", () => {
    const text = "Portfolio: www.nomaddesign.co - available for Figma critiques";
    render(<div data-testid="bio">{renderSanitizedBioText(text)}</div>);

    const link = screen.getByRole("link", { name: "www.nomaddesign.co" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://www.nomaddesign.co");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
