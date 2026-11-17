import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SearchBar as VenuesSearchBar } from "@/components/venues/SearchBar";
import { SearchBar as RootSearchBar } from "@/components/SearchBar";

/**
 * Live search input (#7673): wait 300ms after the last keystroke, send nothing for fewer than 2
 * characters, show a typing indicator while waiting, and let Enter search at once.
 * Both search bars share the same hook, so both are held to the same rules.
 */
describe.each([
  ["venues/SearchBar", VenuesSearchBar],
  ["SearchBar", RootSearchBar],
])("%s debounce and minimum length (#7673)", (_name, SearchBar) => {
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

  const input = () => screen.getByTestId("search-bar-input");
  const type = (value: string) =>
    act(() => {
      fireEvent.change(input(), { target: { value } });
    });
  const wait = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };
  const pressEnter = async () => {
    await act(async () => {
      fireEvent.keyDown(input(), { key: "Enter" });
    });
  };

  describe("debounce", () => {
    it("sends no request until the user pauses for 300ms", async () => {
      render(<SearchBar />);
      type("cafe");

      await wait(299);
      expect(mockFetch).not.toHaveBeenCalled();

      await wait(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain("query=cafe");
    });

    it("sends one request for a burst of keystrokes, with the final text", async () => {
      render(<SearchBar />);
      for (const text of ["ca", "caf", "cafe", "cafe r"]) {
        type(text);
        await wait(100);
      }
      expect(mockFetch).not.toHaveBeenCalled();

      await wait(300);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain("query=cafe%20r");
    });

    it("restarts the 300ms wait on every keystroke", async () => {
      render(<SearchBar />);
      type("cafe");
      await wait(250);
      type("cafes");
      await wait(250);
      expect(mockFetch).not.toHaveBeenCalled();

      await wait(50);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("can be tuned with debounceMs", async () => {
      render(<SearchBar debounceMs={500} />);
      type("cafe");

      await wait(499);
      expect(mockFetch).not.toHaveBeenCalled();
      await wait(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("minimum query length", () => {
    it("sends no request for a one character query, however long the pause", async () => {
      render(<SearchBar />);
      type("a");
      await wait(2000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sends a request once the query reaches two characters", async () => {
      render(<SearchBar />);
      type("a");
      await wait(300);
      expect(mockFetch).not.toHaveBeenCalled();

      type("ab");
      await wait(300);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain("query=ab");
    });

    it("counts the trimmed query: one letter plus spaces is still too short", async () => {
      render(<SearchBar />);
      type("  a  ");
      await wait(1000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sends the trimmed text when the query is long enough", async () => {
      render(<SearchBar />);
      type("  ab  ");
      await wait(300);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain("query=ab");
      expect(mockFetch.mock.calls[0][0]).not.toContain("%20");
    });

    it("stops a pending search when the query is shortened below the minimum", async () => {
      render(<SearchBar />);
      type("ab");
      await wait(100);
      type("a");
      await wait(1000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("resets the search, with no request, when the query is emptied", async () => {
      render(<SearchBar />);
      type("ab");
      await wait(100);
      type("");
      await wait(1000);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("search-bar-results"),
      ).not.toBeInTheDocument();
    });

    it("can be tuned with minQueryLength", async () => {
      render(<SearchBar minQueryLength={3} />);
      type("ab");
      await wait(300);
      expect(mockFetch).not.toHaveBeenCalled();

      type("abc");
      await wait(300);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Enter bypasses the debounce", () => {
    it("searches at once, without waiting 300ms, and only once", async () => {
      render(<SearchBar />);
      type("cafe");
      await pressEnter();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain("query=cafe");

      await wait(1000);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not send a one character query either", async () => {
      render(<SearchBar />);
      type("a");
      await pressEnter();
      await wait(1000);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls onSearch with the trimmed text straight away", async () => {
      const onSearch = jest.fn();
      render(<SearchBar onSearch={onSearch} />);
      type("  cafe  ");
      await pressEnter();
      expect(onSearch).toHaveBeenCalledWith("cafe");
    });
  });

  describe("typing indicator", () => {
    const indicator = () => screen.queryByTestId("search-bar-typing-indicator");

    it("is not shown when idle", () => {
      render(<SearchBar />);
      expect(indicator()).not.toBeInTheDocument();
    });

    it("shows while the debounce is waiting and hands over to the loader when the request starts", async () => {
      let resolveFetch: (value: unknown) => void = () => {};
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );
      render(<SearchBar />);
      type("cafe");

      expect(indicator()).toBeInTheDocument();
      expect(screen.queryByTestId("search-bar-loader")).not.toBeInTheDocument();

      await wait(300);
      expect(indicator()).not.toBeInTheDocument();
      expect(screen.getByTestId("search-bar-loader")).toBeInTheDocument();

      await act(async () => {
        resolveFetch({ ok: true, json: async () => ({ venues: [] }) });
      });
      expect(screen.queryByTestId("search-bar-loader")).not.toBeInTheDocument();
      expect(indicator()).not.toBeInTheDocument();
    });

    it("never shows next to the loader when typing again while a request is still running", async () => {
      mockFetch.mockReturnValue(new Promise(() => {}));
      render(<SearchBar />);
      type("cafe");
      await wait(300);
      expect(screen.getByTestId("search-bar-loader")).toBeInTheDocument();

      type("cafes");
      expect(screen.getByTestId("search-bar-loader")).toBeInTheDocument();
      expect(indicator()).not.toBeInTheDocument();
    });

    it("is hidden from screen readers", () => {
      render(<SearchBar />);
      type("cafe");
      expect(indicator()).toHaveAttribute("aria-hidden", "true");
    });

    it("is not shown for a query that is too short to search", async () => {
      render(<SearchBar />);
      type("a");
      expect(indicator()).not.toBeInTheDocument();
    });

    it("goes away when Enter searches at once", async () => {
      render(<SearchBar />);
      type("cafe");
      expect(indicator()).toBeInTheDocument();

      await pressEnter();
      expect(indicator()).not.toBeInTheDocument();
    });

    it("goes away when the query is cleared", () => {
      render(<SearchBar />);
      type("cafe");
      expect(indicator()).toBeInTheDocument();

      type("");
      expect(indicator()).not.toBeInTheDocument();
    });
  });
});
