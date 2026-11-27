import { RecurringSeriesManager } from "@/features/seats/recurringSeriesStore";
import { validateRecurringBookingSlots } from "@/features/seats/recurringBookingService";
import { NextRequest } from "next/server";
import { createRecurringAvailabilityHandler } from "@/app/api/seats/recurring-availability/route";

function makeAvailabilityRequest(body: unknown, query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/seats/recurring-availability${query}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("RecurringSeriesManager (#10691)", () => {
  it("creates a recurring series atomically and rejects overlapping series", async () => {
    const manager = new RecurringSeriesManager();
    manager.registerSeat("desk-2");

    const first = manager.createSeries({
      seatId: "desk-1",
      userId: "user-a",
      rrulePattern: "FREQ=WEEKLY;BYDAY=MO,WE",
      dateRange: { startDate: "2026-11-02", endDate: "2026-11-11" },
    });
    expect(first.created).toBe(true);
    expect(first.series?.occurrences.length).toBe(4);

    // Overlapping series on desk-1 is rejected atomically
    const overlapping = manager.createSeries({
      seatId: "desk-1",
      userId: "user-b",
      rrulePattern: "FREQ=WEEKLY;BYDAY=WE",
      dateRange: { startDate: "2026-11-04", endDate: "2026-11-18" },
    });
    expect(overlapping.created).toBe(false);
    expect(overlapping.conflicts?.map((c) => c.date)).toEqual([
      "2026-11-04",
      "2026-11-11",
    ]);

    // Availability validation sees real occupancy and suggests desk-2
    const availability = await validateRecurringBookingSlots(
      "desk-1",
      "FREQ=WEEKLY;BYDAY=WE",
      { startDate: "2026-11-04", endDate: "2026-11-11" },
      manager,
    );
    expect(availability.conflictedDates.length).toBe(2);
    expect(availability.alternativeDesks[0]?.deskId).toBe("desk-2");
    expect(availability.alternativeDesks[0]?.availableForAllRequestedDates).toBe(
      true,
    );
  });

  it("supports skipping, modifying, and cancelling individual occurrences without corrupting the series", async () => {
    const manager = new RecurringSeriesManager();
    const res = manager.createSeries({
      seatId: "desk-1",
      userId: "user-a",
      rrulePattern: "FREQ=WEEKLY;BYDAY=MO",
      dateRange: { startDate: "2026-11-02", endDate: "2026-11-16" },
    });
    const seriesId = res.series!.seriesId;

    // Skip 2026-11-09
    expect(manager.skipOccurrence(seriesId, "2026-11-09")).toBe(true);
    const occAfterSkip = await manager.getOccupiedDates("desk-1", [
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
    expect(occAfterSkip.has("2026-11-09")).toBe(false);
    expect(occAfterSkip.has("2026-11-02")).toBe(true);

    // Move 2026-11-16 to 2026-11-17
    const mod = manager.modifyOccurrence(seriesId, "2026-11-16", {
      newDate: "2026-11-17",
    });
    expect(mod.updated).toBe(true);

    const occAfterMod = await manager.getOccupiedDates("desk-1", [
      "2026-11-16",
      "2026-11-17",
    ]);
    expect(occAfterMod.has("2026-11-16")).toBe(false);
    expect(occAfterMod.has("2026-11-17")).toBe(true);

    // Cancel entire series
    expect(manager.cancelSeries(seriesId)).toBe(true);
    const occAfterCancel = await manager.getOccupiedDates("desk-1", [
      "2026-11-02",
      "2026-11-17",
    ]);
    expect(occAfterCancel.size).toBe(0);
  });
});

describe("Recurring availability dry-run preview", () => {
  const request = {
    seatId: "desk-1",
    rrulePattern: "FREQ=WEEKLY;BYDAY=MO",
    dateRange: { startDate: "2026-11-02", endDate: "2026-11-16" },
  };

  it("returns conflicting occurrence dates for a body-based dry run", async () => {
    const manager = new RecurringSeriesManager();
    manager.createSeries({
      seatId: "desk-1",
      userId: "user-a",
      rrulePattern: "FREQ=WEEKLY;BYDAY=MO",
      dateRange: request.dateRange,
    });

    const handler = createRecurringAvailabilityHandler(manager);
    const response = await handler(
      makeAvailabilityRequest({ ...request, dryRun: true }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      conflictingDates: ["2026-11-02", "2026-11-09", "2026-11-16"],
    });
  });

  it("supports query-parameter dry run and returns an empty list without conflicts", async () => {
    const manager = new RecurringSeriesManager();
    const handler = createRecurringAvailabilityHandler(manager);

    const response = await handler(
      makeAvailabilityRequest(request, "?dryRun=true"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      conflictingDates: [],
      requestedDates: ["2026-11-02", "2026-11-09", "2026-11-16"],
      availableDates: ["2026-11-02", "2026-11-09", "2026-11-16"],
    });
  });

  it("does not create or mutate recurring reservations during dry run", async () => {
    const manager = new RecurringSeriesManager();
    const existing = manager.createSeries({
      seatId: "desk-1",
      userId: "user-a",
      rrulePattern: "FREQ=WEEKLY;BYDAY=MO",
      dateRange: {
        startDate: "2026-11-09",
        endDate: "2026-11-09",
      },
    });
    const createSeries = jest.spyOn(manager, "createSeries");
    const before = await manager.getOccupiedDates("desk-1", [
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);

    const handler = createRecurringAvailabilityHandler(manager);
    const response = await handler(
      makeAvailabilityRequest({ ...request, dryRun: true }),
    );

    expect(response.status).toBe(200);
    expect(createSeries).not.toHaveBeenCalled();
    expect(manager.getSeries(existing.series!.seriesId)).toEqual(existing.series);
    expect(
      await manager.getOccupiedDates("desk-1", [
        "2026-11-02",
        "2026-11-09",
        "2026-11-16",
      ]),
    ).toEqual(before);
  });

  it("keeps the normal response shape and series creation behavior", async () => {
    const manager = new RecurringSeriesManager();
    const handler = createRecurringAvailabilityHandler(manager);
    const response = await handler(makeAvailabilityRequest(request));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("conflictingDates");

    const created = manager.createSeries({
      seatId: request.seatId,
      userId: "user-a",
      rrulePattern: request.rrulePattern,
      dateRange: request.dateRange,
    });
    expect(created.created).toBe(true);
    expect(created.series?.occurrences).toHaveLength(3);
  });
});
