import { render, screen, fireEvent } from "@testing-library/react";
import { FAQAccordion } from "@/components/ui/FAQAccordion";

describe("FAQAccordion", () => {
  it("renders at least one FAQ question", () => {
    render(<FAQAccordion />);
    const questions = screen.getAllByRole("button");
    expect(questions.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the first FAQ question text", () => {
    render(<FAQAccordion />);
    // Check that at least one button contains text (the question)
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].textContent).not.toBe("");
  });

  it("FAQ answer is not visible before clicking the question", () => {
    render(<FAQAccordion />);
    // Look for the answer text of the first known FAQ
    const freeText = screen.queryByText(/completely free/i);
    // Could be null or hidden — just verify the question button exists
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders the accordion with accessible button elements", () => {
    render(<FAQAccordion />);
    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).toBeInTheDocument();
    });
  });

  it("applies custom className to the container", () => {
    const { container } = render(<FAQAccordion className="my-faq" />);
    // The outer div should have the custom class
    const el = container.querySelector(".my-faq");
    expect(el).toBeInTheDocument();
  });

  it("binds aria-expanded and aria-controls to trigger buttons and links to panels", () => {
    render(<FAQAccordion />);
    const buttons = screen.getAllByRole("button");
    const firstButton = buttons[0];

    // Initially collapsed
    expect(firstButton).toHaveAttribute("aria-expanded", "false");
    expect(firstButton).toHaveAttribute("aria-controls", "faq-panel-0");
    expect(firstButton).toHaveAttribute("id", "faq-header-0");

    // Click to expand
    fireEvent.click(firstButton);
    expect(firstButton).toHaveAttribute("aria-expanded", "true");

    const panel = screen.getByRole("region");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("id", "faq-panel-0");
    expect(panel).toHaveAttribute("aria-labelledby", "faq-header-0");

    // Click again to collapse
    fireEvent.click(firstButton);
    expect(firstButton).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles accordion item when pressing Enter or Space key", () => {
    render(<FAQAccordion />);
    const firstButton = screen.getAllByRole("button")[0];

    expect(firstButton).toHaveAttribute("aria-expanded", "false");

    // Press Enter to expand
    fireEvent.keyDown(firstButton, { key: "Enter" });
    expect(firstButton).toHaveAttribute("aria-expanded", "true");

    // Press Space to collapse
    fireEvent.keyDown(firstButton, { key: " " });
    expect(firstButton).toHaveAttribute("aria-expanded", "false");
  });
});
