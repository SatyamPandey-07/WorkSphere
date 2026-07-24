import { render, screen } from "@testing-library/react";
import SiteFooter from "@/components/site-footer";

describe("SiteFooter Component", () => {
  it("has the correct ARIA landmark roles and labels", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveAttribute("aria-label", "Footer Navigation");
  });

  it("applies focus-visible rings to interactive elements", () => {
    render(<SiteFooter />);

    // Check Links
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => {
      expect(link.className).toMatch(/focus-visible:ring-2/);
    });

    // Check Newsletter Input
    const input = screen.getByRole("textbox", {
      name: /email address for newsletter/i,
    });
    expect(input.className).toMatch(/focus-visible:ring-2/);

    // Check Subscribe Button
    const button = screen.getByRole("button", { name: /subscribe/i });
    expect(button.className).toMatch(/focus-visible:ring-2/);
  });
});
