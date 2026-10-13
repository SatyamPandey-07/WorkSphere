import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SearchBar, trimSearchQuery } from "@/components/venues/SearchBar";

describe("SearchBar component (#4401, #4404)", () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
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

  it("renders with placeholder and initial state", () => {
    render(<SearchBar placeholder="Find your workplace..." />);

    const input = screen.getByTestId("search-bar-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "Find your workplace...");
    expect(input).toHaveValue("");

    // Clear button should not be present when query is empty
    expect(
      screen.queryByTestId("search-bar-clear-btn"),
    ).not.toBeInTheDocument();
    // Shortcut badge should be visible when query is empty
    expect(screen.getByTestId("search-bar-shortcut-badge")).toBeInTheDocument();
  });

  it("shows clear button when text is typed into the input", () => {
    render(<SearchBar />);

    const input = screen.getByTestId("search-bar-input");
    act(() => {
      fireEvent.change(input, { target: { value: "Cafe" } });
    });

    expect(input).toHaveValue("Cafe");
    expect(screen.getByTestId("search-bar-clear-btn")).toBeInTheDocument();
    expect(
      screen.queryByTestId("search-bar-shortcut-badge"),
    ).not.toBeInTheDocument();
  });

  it("clears search input, calls onSearch, and refocuses search bar when clear button is clicked", () => {
    const onSearch = jest.fn();
    render(<SearchBar initialQuery="Library" onSearch={onSearch} />);

    const input = screen.getByTestId("search-bar-input");
    expect(input).toHaveValue("Library");

    const clearBtn = screen.getByTestId("search-bar-clear-btn");
    expect(clearBtn).toBeInTheDocument();

    const focusSpy = jest.spyOn(input, "focus");
    act(() => {
      fireEvent.click(clearBtn);
    });

    expect(input).toHaveValue("");
    expect(onSearch).toHaveBeenCalledWith("");
    expect(
      screen.queryByTestId("search-bar-clear-btn"),
    ).not.toBeInTheDocument();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("prevents search dropdown from closing when clear button is clicked (#4371)", () => {
    render(<SearchBar initialQuery="Library" />);

    const input = screen.getByTestId("search-bar-input");
    const clearBtn = screen.getByTestId("search-bar-clear-btn");
    const focusSpy = jest.spyOn(input, "focus");

    const mouseDownEvent = fireEvent.mouseDown(clearBtn);
    const clickEvent = fireEvent.click(clearBtn);

    expect(input).toHaveValue("");
    expect(focusSpy).toHaveBeenCalled();
  });

  it("clears search input, triggers onSearch, and blurs input when pressing Escape key", () => {
    const onSearch = jest.fn();
    render(<SearchBar initialQuery="Coworking Space" onSearch={onSearch} />);

    const input = screen.getByTestId("search-bar-input");
    expect(input).toHaveValue("Coworking Space");

    const blurSpy = jest.spyOn(input, "blur");
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(input).toHaveValue("");
    expect(onSearch).toHaveBeenCalledWith("");
    expect(
      screen.queryByTestId("search-bar-clear-btn"),
    ).not.toBeInTheDocument();
    expect(blurSpy).toHaveBeenCalled();
  });

  it("closes results dropdown on Escape key when query is empty", () => {
    render(<SearchBar />);

    const input = screen.getByTestId("search-bar-input");
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(input).toHaveValue("");
    expect(screen.queryByTestId("search-bar-results")).not.toBeInTheDocument();
  });

  it("renders search results and handles venue selection", async () => {
    const mockVenues = [
      {
        id: "1",
        name: "Artisan Coffee",
        address: "123 Main St",
        category: "cafe",
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ venues: mockVenues }),
    });

    const onSelect = jest.fn();
    render(<SearchBar onSelect={onSelect} />);

    const input = screen.getByTestId("search-bar-input");
    act(() => {
      fireEvent.change(input, { target: { value: "Artisan" } });
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    const results = screen.getByTestId("search-bar-results");
    expect(results).toBeInTheDocument();

    const option = screen.getByRole("option");
    expect(option).toHaveTextContent("Artisan Coffee");

    act(() => {
      fireEvent.click(option);
    });
    expect(onSelect).toHaveBeenCalledWith(mockVenues[0]);
    expect(input).toHaveValue("Artisan Coffee");
  });

  it("shows a clickable typo suggestion and searches for the suggested query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        venues: [],
        suggestedQuery: "Starbucks",
      }),
    });

    render(<SearchBar />);
    const input = screen.getByTestId("search-bar-input");

    act(() => {
      fireEvent.change(input, { target: { value: "Starbuks" } });
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    const suggestion = await screen.findByRole("button", { name: "Starbucks" });
    expect(screen.getByTestId("search-bar-suggestion")).toHaveTextContent(
      "Did you mean: Starbucks?",
    );

    fireEvent.click(suggestion);
    expect(input).toHaveValue("Starbucks");

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/venues?query=Starbucks",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  describe("Accessibility aria-live announcements (#4404)", () => {
    it("renders polite aria-live container with role status", () => {
      render(<SearchBar />);

      const liveRegion = screen.getByTestId("search-results-announcement");
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
      expect(liveRegion).toHaveAttribute("role", "status");
      expect(liveRegion).toHaveTextContent("");
    });

    it("announces matching results count once debounce settles", async () => {
      const mockVenues = [
        {
          id: "1",
          name: "Artisan Cafe",
          address: "123 Main St",
          category: "cafe",
        },
        {
          id: "2",
          name: "Downtown Desk",
          address: "456 Market St",
          category: "coworking",
        },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ venues: mockVenues }),
      });

      render(<SearchBar />);
      const input = screen.getByTestId("search-bar-input");

      act(() => {
        fireEvent.change(input, { target: { value: "Cafe" } });
      });

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      const liveRegion = screen.getByTestId("search-results-announcement");
      expect(liveRegion).toHaveTextContent("2 venues found");
    });

    it("announces 'No venues found' when search returns 0 results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ venues: [] }),
      });

      render(<SearchBar />);
      const input = screen.getByTestId("search-bar-input");

      act(() => {
        fireEvent.change(input, { target: { value: "UnknownPlaceXYZ" } });
      });

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      const liveRegion = screen.getByTestId("search-results-announcement");
      expect(liveRegion).toHaveTextContent("No venues found");
    });
  });

  describe("Whitespace trimming and empty query prevention (#4788)", () => {
    it("trims leading and trailing whitespace using trimSearchQuery helper", () => {
      expect(trimSearchQuery("   Cafe Central   ")).toBe("Cafe Central");
      expect(trimSearchQuery("Workspace   ")).toBe("Workspace");
      expect(trimSearchQuery("   Downtown Desk")).toBe("Downtown Desk");
      expect(trimSearchQuery("     ")).toBe("");
      expect(trimSearchQuery("")).toBe("");
    });

    it("trims leading and trailing whitespace before invoking onSearch on Enter key", () => {
      const onSearch = jest.fn();
      render(<SearchBar onSearch={onSearch} />);

      const input = screen.getByTestId("search-bar-input");
      act(() => {
        fireEvent.change(input, { target: { value: "   Coworking Hub   " } });
      });

      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      expect(onSearch).toHaveBeenCalledWith("Coworking Hub");
    });

    it("prevents queries containing only whitespace from triggering search fetch on Enter", () => {
      const onSearch = jest.fn();
      render(<SearchBar onSearch={onSearch} />);

      const input = screen.getByTestId("search-bar-input");
      act(() => {
        fireEvent.change(input, { target: { value: "     " } });
      });

      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      expect(onSearch).toHaveBeenCalledWith("");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("prevents debounced search fetch when query contains only whitespace", async () => {
      render(<SearchBar debounceMs={100} />);

      const input = screen.getByTestId("search-bar-input");
      act(() => {
        fireEvent.change(input, { target: { value: "     " } });
      });

      await act(async () => {
        jest.advanceTimersByTime(250);
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
