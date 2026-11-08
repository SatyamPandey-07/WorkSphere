import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SearchBar, trimSearchQuery, isValidSearchQuery } from "@/components/SearchBar";

// Mock Next.js navigation hooks
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/search",
}));

describe("Search Input Whitespace Trimming & Sanitization", () => {
  describe("trimSearchQuery helper", () => {
    it("strips leading and trailing spaces from queries", () => {
      expect(trimSearchQuery("   Artisan Roasters   ")).toBe("Artisan Roasters");
      expect(trimSearchQuery("  San Francisco, CA  ")).toBe("San Francisco, CA");
      expect(trimSearchQuery("   ")).toBe("");
      expect(trimSearchQuery("")).toBe("");
    });

    it("evaluates isValidSearchQuery correctly", () => {
      expect(isValidSearchQuery("  Tech Hub  ")).toBe(true);
      expect(isValidSearchQuery("     ")).toBe(false);
      expect(isValidSearchQuery("")).toBe(false);
    });
  });

  describe("SearchBar Component interaction", () => {
    it("trims whitespace before triggering onSearch callback", async () => {
      const handleSearch = jest.fn();
      render(<SearchBar onSearch={handleSearch} debounceMs={50} />);

      const input = screen.getByTestId("search-bar-input");
      fireEvent.change(input, { target: { value: "   Coworking Central   " } });

      await waitFor(() => {
        expect(handleSearch).toHaveBeenCalledWith("Coworking Central");
      });
    });

    it("displays clean validation message when input consists purely of spaces", async () => {
      const handleSearch = jest.fn();
      render(<SearchBar onSearch={handleSearch} />);

      const input = screen.getByTestId("search-bar-input");
      fireEvent.change(input, { target: { value: "     " } });

      const errorMsg = await screen.findByTestId("search-validation-error");
      expect(errorMsg).toBeInTheDocument();
      expect(errorMsg).toHaveTextContent("Search query cannot be only whitespace.");

      // Verify empty search is not dispatched
      expect(handleSearch).not.toHaveBeenCalledWith("     ");
    });

    it("displays validation feedback on Enter key submit with whitespace", async () => {
      const handleSearch = jest.fn();
      render(<SearchBar onSearch={handleSearch} />);

      const input = screen.getByTestId("search-bar-input");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      const errorMsg = await screen.findByTestId("search-validation-error");
      expect(errorMsg).toBeInTheDocument();
      expect(handleSearch).not.toHaveBeenCalledWith("   ");
    });

    it("clears validation error when valid text is typed", async () => {
      render(<SearchBar />);

      const input = screen.getByTestId("search-bar-input");
      fireEvent.change(input, { target: { value: "   " } });
      expect(await screen.findByTestId("search-validation-error")).toBeInTheDocument();

      fireEvent.change(input, { target: { value: "   Workspace A   " } });
      await waitFor(() => {
        expect(screen.queryByTestId("search-validation-error")).not.toBeInTheDocument();
      });
    });
  });
});
