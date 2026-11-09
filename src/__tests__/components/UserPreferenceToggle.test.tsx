import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { UserPreferenceToggle } from "@/components/UserPreferenceToggle";

describe("UserPreferenceToggle Component (#6907)", () => {
  const mockOnToggle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders default title and description", () => {
    render(<UserPreferenceToggle enabled={false} onToggle={mockOnToggle} />);

    expect(screen.getByTestId("user-preference-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("user-preference-toggle-title")).toHaveTextContent(
      "Personalized AI Recommendations"
    );
    expect(screen.getByTestId("user-preference-toggle-desc")).toHaveTextContent(
      "Re-rank search results based on your check-in history, saved venues, and ratings."
    );
  });

  it("reflects unchecked state when enabled is false", () => {
    render(<UserPreferenceToggle enabled={false} onToggle={mockOnToggle} />);

    const input = screen.getByTestId("user-preference-toggle-input") as HTMLInputElement;
    expect(input.checked).toBe(false);
    expect(input).toHaveAttribute("aria-checked", "false");
    expect(input).toHaveAttribute("role", "switch");
  });

  it("reflects checked state when enabled is true", () => {
    render(<UserPreferenceToggle enabled={true} onToggle={mockOnToggle} />);

    const input = screen.getByTestId("user-preference-toggle-input") as HTMLInputElement;
    expect(input.checked).toBe(true);
    expect(input).toHaveAttribute("aria-checked", "true");
  });

  it("associates label htmlFor with input id", () => {
    render(<UserPreferenceToggle enabled={false} onToggle={mockOnToggle} />);

    const input = screen.getByTestId("user-preference-toggle-input");
    const titleLabel = screen.getByTestId("user-preference-toggle-title");
    const switchLabel = screen.getByTestId("user-preference-toggle-switch");

    const inputId = input.getAttribute("id");
    expect(inputId).toBeTruthy();
    expect(titleLabel).toHaveAttribute("for", inputId);
    expect(switchLabel).toHaveAttribute("for", inputId);
  });

  it("uses custom id when provided", () => {
    render(
      <UserPreferenceToggle
        id="custom-pref-switch-123"
        enabled={false}
        onToggle={mockOnToggle}
      />
    );

    const input = screen.getByTestId("user-preference-toggle-input");
    const titleLabel = screen.getByTestId("user-preference-toggle-title");

    expect(input).toHaveAttribute("id", "custom-pref-switch-123");
    expect(titleLabel).toHaveAttribute("for", "custom-pref-switch-123");
  });

  it("calls onToggle with true when toggling from unchecked to checked", () => {
    render(<UserPreferenceToggle enabled={false} onToggle={mockOnToggle} />);

    const input = screen.getByTestId("user-preference-toggle-input");
    fireEvent.click(input);

    expect(mockOnToggle).toHaveBeenCalledTimes(1);
    expect(mockOnToggle).toHaveBeenCalledWith(true);
  });

  it("calls onToggle with false when toggling from checked to unchecked", () => {
    render(<UserPreferenceToggle enabled={true} onToggle={mockOnToggle} />);

    const input = screen.getByTestId("user-preference-toggle-input");
    fireEvent.click(input);

    expect(mockOnToggle).toHaveBeenCalledTimes(1);
    expect(mockOnToggle).toHaveBeenCalledWith(false);
  });

  it("toggles state when clicking on the title label", () => {
    render(<UserPreferenceToggle enabled={false} onToggle={mockOnToggle} />);

    const titleLabel = screen.getByTestId("user-preference-toggle-title");
    fireEvent.click(titleLabel);

    expect(mockOnToggle).toHaveBeenCalledWith(true);
  });

  it("renders custom title, description, and badge", () => {
    render(
      <UserPreferenceToggle
        enabled={true}
        onToggle={mockOnToggle}
        title="Custom Preference"
        description="Custom description text for testing."
        badge={<span data-testid="test-badge">PRO</span>}
      />
    );

    expect(screen.getByTestId("user-preference-toggle-title")).toHaveTextContent("Custom Preference");
    expect(screen.getByTestId("user-preference-toggle-desc")).toHaveTextContent(
      "Custom description text for testing."
    );
    expect(screen.getByTestId("test-badge")).toHaveTextContent("PRO");
  });

  it("omits description when empty string is provided", () => {
    render(
      <UserPreferenceToggle
        enabled={true}
        onToggle={mockOnToggle}
        description=""
      />
    );

    expect(screen.queryByTestId("user-preference-toggle-desc")).not.toBeInTheDocument();
  });

  it("handles disabled state: disables input, styles container, and prevents onToggle", () => {
    render(<UserPreferenceToggle enabled={false} onToggle={mockOnToggle} disabled={true} />);

    const input = screen.getByTestId("user-preference-toggle-input") as HTMLInputElement;
    const container = screen.getByTestId("user-preference-toggle");

    expect(input).toBeDisabled();
    expect(container).toHaveClass("opacity-60", "cursor-not-allowed");

    fireEvent.click(input);
    expect(mockOnToggle).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { checked: true } });
    expect(mockOnToggle).not.toHaveBeenCalled();
  });

  it("applies custom className to outer container", () => {
    render(
      <UserPreferenceToggle
        enabled={true}
        onToggle={mockOnToggle}
        className="custom-margin my-special-class"
      />
    );

    const container = screen.getByTestId("user-preference-toggle");
    expect(container).toHaveClass("custom-margin", "my-special-class");
  });
});
