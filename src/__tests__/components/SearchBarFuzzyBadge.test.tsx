import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SearchBar as VenuesSearchBar } from "@/components/venues/SearchBar";
import { SearchBar as HeaderSearchBar } from "@/components/SearchBar";

const VENUES = [
  { id: "f1", name: "Blue Tokai Coffee", category: "cafe", fuzzyMatched: true },
  { id: "s1", name: "Third Wave Coffee", category: "cafe" },
];

describe.each([
  ["venues/SearchBar", VenuesSearchBar],
  ["SearchBar", HeaderSearchBar],
])("%s fuzzy match badge (#7846)", (_name, SearchBar) => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ venues: VENUES, lowConfidenceFallback: true }),
    });
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it("labels only the venues the API marked as fuzzy matches", async () => {
    render(<SearchBar />);

    const input = screen.getByTestId("search-bar-input");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "blue tokia" } });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Fuzzy match suggestion");
    expect(options[1]).not.toHaveTextContent("Fuzzy match suggestion");
    expect(screen.getAllByTestId("search-bar-fuzzy-badge")).toHaveLength(1);
  });
});
