import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { VenueSummary } from "@/components/venue/VenueSummary";

describe("VenueSummary", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders loading skeleton initially and displays summary on successful fetch", async () => {
    const fakeSummary = "Cozy cafe with fast gigabit wifi and spacious workstations.";
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ summary: fakeSummary }),
    } as Response);

    const onLoaded = jest.fn();

    render(
      <VenueSummary
        venueId="venue-123"
        onLoaded={onLoaded}
        className="custom-summary"
        testId="my-summary"
      />
    );

    // Initial loading state
    expect(screen.getByRole("region", { name: /AI Venue Summary/i })).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading AI summary");
    expect(screen.getByTestId("my-summary-loading")).toBeInTheDocument();

    // Wait for fetch completion
    await waitFor(() => {
      expect(screen.getByText(fakeSummary)).toBeInTheDocument();
    });

    expect(screen.getByTestId("my-summary")).toHaveClass("custom-summary");
    expect(screen.getByTestId("my-summary-text")).toHaveTextContent(fakeSummary);
    expect(onLoaded).toHaveBeenCalledWith(fakeSummary);
    expect(global.fetch).toHaveBeenCalledWith("/api/venues/venue-123/summary");
  });

  it("safely handles initialSummary prop without executing network fetch", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const onLoaded = jest.fn();

    render(
      <VenueSummary
        venueId="venue-456"
        initialSummary="Pre-rendered summary text"
        onLoaded={onLoaded}
      />
    );

    expect(screen.getByText("Pre-rendered summary text")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onLoaded).toHaveBeenCalledWith("Pre-rendered summary text");
  });

  it("gracefully returns null when venueId is empty or whitespace", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const onLoaded = jest.fn();

    const { container } = render(
      <VenueSummary venueId="   " onLoaded={onLoaded} />
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    expect(onLoaded).toHaveBeenCalledWith(null);
  });

  it("properly encodes venueId in URL request", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ summary: "Encoded venue details" }),
    } as Response);

    render(<VenueSummary venueId="venue/with space&special" />);

    await waitFor(() => {
      expect(screen.getByText("Encoded venue details")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/venues/${encodeURIComponent("venue/with space&special")}/summary`
    );
  });

  it("handles HTTP error response gracefully without crashing", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: "Internal server error" }),
    } as Response);

    const onError = jest.fn();
    const onLoaded = jest.fn();

    const { container } = render(
      <VenueSummary
        venueId="venue-err"
        onError={onError}
        onLoaded={onLoaded}
      />
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    expect(onLoaded).toHaveBeenCalledWith(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("handles network rejection gracefully", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("Network failed"));

    const onError = jest.fn();

    const { container } = render(
      <VenueSummary venueId="venue-net-err" onError={onError} />
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Network failed" })
      );
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("handles empty or non-string summary payload safely", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ summary: 12345 }), // non-string
    } as Response);

    const onLoaded = jest.fn();

    const { container } = render(
      <VenueSummary venueId="venue-invalid-type" onLoaded={onLoaded} />
    );

    await waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith(null);
    });

    expect(container).toBeEmptyDOMElement();
  });
});
