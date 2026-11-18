import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { SearchBar } from "@/components/venues/SearchBar";
import {
  RECENT_SEARCHES_STORAGE_KEY,
  getRecentSearches,
} from "@/lib/recentSearches";

describe("SearchBar recent searches (#7731)", () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  const seed = (list: string[]) =>
    window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(list));
  const input = () => screen.getByTestId("search-bar-input");
  const focusInput = () => act(() => void fireEvent.focus(input()));
  const items = () => screen.queryAllByTestId("search-bar-recent-item");
  const press = (key: string) => act(() => void fireEvent.keyDown(input(), { key }));

  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ venues: [] }),
    });
    global.fetch = mockFetch;
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe("showing the list", () => {
    it("shows saved searches when the empty input receives focus", () => {
      seed(["coffee with outdoor seating", "quiet library"]);
      render(<SearchBar />);

      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();
      focusInput();

      expect(screen.getByTestId("search-bar-recent")).toBeInTheDocument();
      expect(items().map((li) => li.textContent)).toEqual([
        "coffee with outdoor seating",
        "quiet library",
      ]);
      expect(input()).toHaveAttribute("aria-expanded", "true");
      expect(input()).toHaveAttribute("aria-controls", "search-bar-recent-list");
    });

    it("shows nothing when there are no saved searches", () => {
      render(<SearchBar />);
      focusInput();
      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();
      expect(input()).toHaveAttribute("aria-expanded", "false");
    });

    it("hides the list while typing and when the query is not empty", () => {
      seed(["library"]);
      render(<SearchBar />);
      focusInput();
      expect(items()).toHaveLength(1);

      act(() => void fireEvent.change(input(), { target: { value: "ca" } }));
      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();
    });

    it("does not show the list for a bar that starts with a query", () => {
      seed(["library"]);
      render(<SearchBar initialQuery="Cafe" />);
      focusInput();
      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();
    });

    it("closes when clicking outside", () => {
      seed(["library"]);
      render(<SearchBar />);
      focusInput();
      expect(items()).toHaveLength(1);

      act(() => void fireEvent.mouseDown(document.body));
      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();
    });
  });

  describe("one tap re-query", () => {
    it("fills the input and searches immediately when an item is clicked", async () => {
      seed(["coffee with outdoor seating", "quiet library"]);
      const onSearch = jest.fn();
      render(<SearchBar onSearch={onSearch} syncWithUrl={false} />);
      focusInput();

      await act(async () => {
        fireEvent.click(items()[1]);
      });

      expect(input()).toHaveValue("quiet library");
      expect(onSearch).toHaveBeenCalledWith("quiet library");
      expect(
        mockFetch.mock.calls.some(([url]) => String(url).includes("quiet%20library") || String(url).includes("quiet+library")),
      ).toBe(true);
      // moved to the front of the stored list
      expect(getRecentSearches()).toEqual(["quiet library", "coffee with outdoor seating"]);
    });
  });

  describe("saving searches", () => {
    it("saves a search submitted with Enter", async () => {
      render(<SearchBar syncWithUrl={false} />);
      act(() => void fireEvent.change(input(), { target: { value: "  Quiet   Cafe " } }));
      await act(async () => {
        fireEvent.keyDown(input(), { key: "Enter" });
      });

      expect(getRecentSearches()).toEqual(["Quiet Cafe"]);
    });

    it("does not save an empty or whitespace only submit", async () => {
      render(<SearchBar syncWithUrl={false} />);
      act(() => void fireEvent.change(input(), { target: { value: "   " } }));
      await act(async () => {
        fireEvent.keyDown(input(), { key: "Enter" });
      });

      expect(getRecentSearches()).toEqual([]);
    });

    it("keeps at most 10 saved searches", async () => {
      seed(Array.from({ length: 10 }, (_, i) => `old ${i}`));
      render(<SearchBar syncWithUrl={false} />);
      act(() => void fireEvent.change(input(), { target: { value: "brand new" } }));
      await act(async () => {
        fireEvent.keyDown(input(), { key: "Enter" });
      });

      const saved = getRecentSearches();
      expect(saved).toHaveLength(10);
      expect(saved[0]).toBe("brand new");
      expect(saved).not.toContain("old 9");
    });
  });

  describe("removing", () => {
    it("removes one search with its X button without selecting it", () => {
      seed(["one", "two", "three"]);
      const onSearch = jest.fn();
      render(<SearchBar onSearch={onSearch} />);
      focusInput();

      const second = items()[1];
      act(() => void fireEvent.click(within(second).getByTestId("search-bar-recent-remove")));

      expect(items().map((li) => li.textContent)).toEqual(["one", "three"]);
      expect(getRecentSearches()).toEqual(["one", "three"]);
      expect(onSearch).not.toHaveBeenCalled();
      expect(input()).toHaveValue("");
    });

    it("labels each remove button for screen readers", () => {
      seed(["library"]);
      render(<SearchBar />);
      focusInput();
      expect(
        screen.getByRole("button", { name: "Remove library from recent searches" }),
      ).toBeInTheDocument();
    });

    it("clears everything with Clear all and hides the list", () => {
      seed(["one", "two"]);
      render(<SearchBar />);
      focusInput();

      act(() => void fireEvent.click(screen.getByTestId("search-bar-recent-clear-all")));

      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();
      expect(getRecentSearches()).toEqual([]);
    });
  });

  describe("keyboard navigation", () => {
    it("moves through the list with ArrowDown and ArrowUp, wrapping around", () => {
      seed(["one", "two", "three"]);
      render(<SearchBar />);
      focusInput();

      const selected = () => items().findIndex((li) => li.getAttribute("aria-selected") === "true");
      expect(selected()).toBe(-1);

      press("ArrowDown");
      expect(selected()).toBe(0);
      expect(input()).toHaveAttribute("aria-activedescendant", "search-bar-recent-option-0");
      press("ArrowDown");
      press("ArrowDown");
      expect(selected()).toBe(2);
      press("ArrowDown");
      expect(selected()).toBe(0);
      press("ArrowUp");
      expect(selected()).toBe(2);
      press("ArrowUp");
      expect(selected()).toBe(1);
    });

    it("starts from the last item when ArrowUp is the first key", () => {
      seed(["one", "two", "three"]);
      render(<SearchBar />);
      focusInput();
      press("ArrowUp");
      expect(items()[2]).toHaveAttribute("aria-selected", "true");
    });

    it("searches the highlighted item when Enter is pressed", async () => {
      seed(["one", "two", "three"]);
      const onSearch = jest.fn();
      render(<SearchBar onSearch={onSearch} syncWithUrl={false} />);
      focusInput();
      press("ArrowDown");
      press("ArrowDown");

      await act(async () => {
        fireEvent.keyDown(input(), { key: "Enter" });
      });

      expect(input()).toHaveValue("two");
      expect(onSearch).toHaveBeenCalledWith("two");
      expect(getRecentSearches()[0]).toBe("two");
    });

    it("reopens the list with ArrowDown after Escape", () => {
      seed(["one"]);
      render(<SearchBar />);
      focusInput();
      press("Escape");
      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();

      press("ArrowDown");
      expect(screen.getByTestId("search-bar-recent")).toBeInTheDocument();
    });

    it("closes the list and clears the highlight on Escape", () => {
      seed(["one", "two"]);
      render(<SearchBar />);
      focusInput();
      press("ArrowDown");

      press("Escape");
      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();
      expect(input()).not.toHaveAttribute("aria-activedescendant");
    });

    it("does not hijack arrow keys while typing", () => {
      seed(["one"]);
      render(<SearchBar />);
      act(() => void fireEvent.change(input(), { target: { value: "ca" } }));
      press("ArrowDown");
      expect(screen.queryByTestId("search-bar-recent")).not.toBeInTheDocument();
    });
  });
});
