import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ItineraryTimeline, type ItineraryItem } from "@/components/itinerary/ItineraryTimeline";

const initialItems: ItineraryItem[] = [
  { id: "a", venueName: "Alpha Cafe", timeSlot: "09:00", category: "coffee" },
  { id: "b", venueName: "Beta Desk", timeSlot: "10:00", category: "desk" },
  { id: "c", venueName: "Gamma Lounge", timeSlot: "11:00", category: "lounge" },
];

const getOrder = () =>
  screen.getAllByTestId("itinerary-item").map((element) => element.getAttribute("data-item-id"));

describe("ItineraryTimeline history", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as jest.Mock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("supports undo, redo, and keyboard shortcuts while syncing each change", async () => {
    render(<ItineraryTimeline itineraryId="itinerary-1" initialItems={initialItems} />);

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    fireEvent.click(screen.getAllByTitle("Move up")[1]);
    await waitFor(() => expect(getOrder()).toEqual(["b", "a", "c"]));
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(getOrder()).toEqual(["a", "b", "c"]));
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(getOrder()).toEqual(["b", "a", "c"]));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(getOrder()).toEqual(["a", "b", "c"]));

    expect(global.fetch).toHaveBeenCalledTimes(4);
    const lastRequest = (global.fetch as jest.Mock).mock.calls[3];
    expect(lastRequest[0]).toBe("/api/itinerary/itinerary-1");
    expect(JSON.parse(lastRequest[1].body).items.map((item: ItineraryItem) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("restores both the itinerary and history when the server rejects a reorder", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
    const onSyncFailed = jest.fn();

    render(
      <ItineraryTimeline
        itineraryId="itinerary-1"
        initialItems={initialItems}
        onSyncFailed={onSyncFailed}
      />,
    );

    fireEvent.click(screen.getAllByTitle("Move up")[1]);
    await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1));
    expect(getOrder()).toEqual(["a", "b", "c"]);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});
