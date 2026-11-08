import { render, screen, fireEvent } from "@testing-library/react";
import {
  AutocompleteDropdown,
  escapeRegex,
  escapeRegExp,
  sanitizeQuery,
} from "@/components/AutocompleteDropdown";

describe("AutocompleteDropdown - escapeRegex", () => {
  it("escapes regex reserved characters", () => {
    expect(escapeRegex("[test]")).toBe("\\[test\\]");
    expect(escapeRegex("focus (mode)")).toBe("focus \\(mode\\)");
    expect(escapeRegex("c++")).toBe("c\\+\\+");
    expect(escapeRegex("all*")).toBe("all\\*");
    expect(escapeRegex("cost?")).toBe("cost\\?");
    expect(escapeRegex("^start$")).toBe("\\^start\\$");
    expect(escapeRegex("{2,4}")).toBe("\\{2,4\\}");
    expect(escapeRegex("a|b")).toBe("a\\|b");
    expect(escapeRegex("path\\to")).toBe("path\\\\to");
  });

  it("handles non-string or empty inputs gracefully", () => {
    expect(escapeRegex("")).toBe("");
    expect(escapeRegex(null as any)).toBe("");
    expect(escapeRegex(undefined as any)).toBe("");
  });

  it("exports escapeRegExp and sanitizeQuery as aliases", () => {
    expect(escapeRegExp("[abc]")).toBe("\\[abc\\]");
    expect(sanitizeQuery("(abc)")).toBe("\\(abc\\)");
  });
});

describe("AutocompleteDropdown - Component filtering", () => {
  const defaultProps = {
    input: "",
    isOpen: true,
    onSelect: jest.fn(),
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render suggestions when input is empty or only whitespace", () => {
    const { container } = render(
      <AutocompleteDropdown {...defaultProps} input="   " />,
    );
    expect(container.querySelector("button")).not.toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <AutocompleteDropdown {...defaultProps} input="wifi" isOpen={false} />,
    );
    expect(container.querySelector("button")).not.toBeInTheDocument();
  });

  it("renders suggestions when matching normal input", () => {
    render(<AutocompleteDropdown {...defaultProps} input="wifi" />);
    expect(
      screen.getByRole("button", { name: /with wifi/i }),
    ).toBeInTheDocument();
  });

  it("filters smoothly without crashing when input contains unclosed brackets", () => {
    // Unclosed bracket '[' would cause SyntaxError: Unterminated character class in new RegExp('[')
    expect(() => {
      render(<AutocompleteDropdown {...defaultProps} input="[" />);
    }).not.toThrow();

    expect(() => {
      render(<AutocompleteDropdown {...defaultProps} input="[wifi" />);
    }).not.toThrow();
  });

  it("filters smoothly without crashing when input contains unclosed parentheses", () => {
    // Unclosed parenthesis '(' would cause SyntaxError: Unterminated group in new RegExp('(')
    expect(() => {
      render(<AutocompleteDropdown {...defaultProps} input="(" />);
    }).not.toThrow();

    expect(() => {
      render(<AutocompleteDropdown {...defaultProps} input="focus (" />);
    }).not.toThrow();

    // "focus (" contains "focus", which matches "focus mode"
    expect(
      screen.getByRole("button", { name: /focus mode/i }),
    ).toBeInTheDocument();
  });

  it("filters smoothly without crashing when input contains other regex metacharacters (*, +, ?, ^, $, |, \\)", () => {
    const specialInputs = [
      "*",
      "+",
      "?",
      "^",
      "$",
      "\\",
      "c++",
      "wifi*",
      "(quiet)",
    ];

    for (const term of specialInputs) {
      expect(() => {
        const { unmount } = render(
          <AutocompleteDropdown {...defaultProps} input={term} />,
        );
        unmount();
      }).not.toThrow();
    }
  });

  it("calls onSelect when a suggestion is clicked", () => {
    const onSelect = jest.fn();
    render(
      <AutocompleteDropdown
        {...defaultProps}
        input="quiet"
        onSelect={onSelect}
      />,
    );

    const suggestionBtn = screen.getByRole("button", { name: /quiet zone/i });
    fireEvent.click(suggestionBtn);

    expect(onSelect).toHaveBeenCalledWith("quiet zone");
  });

  it("supports keyboard navigation: ArrowDown, ArrowUp, Enter, and Escape", () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();

    render(
      <AutocompleteDropdown
        {...defaultProps}
        input="wifi"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    // Arrow down
    fireEvent.keyDown(window, { key: "ArrowDown" });
    // Arrow up
    fireEvent.keyDown(window, { key: "ArrowUp" });
    // Enter to select
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalled();

    // Escape to close
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
