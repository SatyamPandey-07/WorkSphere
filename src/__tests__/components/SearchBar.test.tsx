import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SearchBar } from "@/components/venues/SearchBar";

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

  it("clears search input and refocuses search bar when clear button is clicked", () => {
    render(<SearchBar initialQuery="Library" />);

    const input = screen.getByTestId("search-bar-input");
    expect(input).toHaveValue("Library");

    const clearBtn = screen.getByTestId("search-bar-clear-btn");
    expect(clearBtn).toBeInTheDocument();

    const focusSpy = jest.spyOn(input, "focus");
    act(() => {
      fireEvent.click(clearBtn);
    });

    expect(input).toHaveValue("");
    expect(
      screen.queryByTestId("search-bar-clear-btn"),
    ).not.toBeInTheDocument();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("clears search input and refocuses when pressing Escape key while input is focused", () => {
    render(<SearchBar initialQuery="Coworking Space" />);

    const input = screen.getByTestId("search-bar-input");
    expect(input).toHaveValue("Coworking Space");

    const focusSpy = jest.spyOn(input, "focus");
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(input).toHaveValue("");
    expect(
      screen.queryByTestId("search-bar-clear-btn"),
    ).not.toBeInTheDocument();
    expect(focusSpy).toHaveBeenCalled();
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
});
