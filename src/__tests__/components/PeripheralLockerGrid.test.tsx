import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PeripheralLockerGrid from "@/components/p2p/PeripheralLockerGrid";
import type { PeripheralItem } from "@/lib/peripherals/peripheralEngine";

const mockRecordHeartbeat = jest.fn();

jest.mock("@/hooks/usePeerLifecycle", () => ({
  usePeerLifecycle: () => ({
    state: "connected",
    recordHeartbeat: mockRecordHeartbeat,
  }),
}));

const makeItem = (overrides: Partial<PeripheralItem>): PeripheralItem => ({
  id: "item",
  venueId: "venue-1",
  name: "Item",
  category: "MOUSE",
  description: "A test peripheral",
  brand: "Test",
  lockerBayNumber: 1,
  condition: "GOOD",
  hourlyRateUsd: 2,
  depositUsd: 20,
  isAvailable: true,
  specifications: [],
  ...overrides,
});

const inventory: PeripheralItem[] = [
  makeItem({
    id: "low",
    name: "Low Battery Mouse",
    category: "MOUSE",
    lockerBayNumber: 1,
    batteryPercent: 15,
  }),
  makeItem({
    id: "full",
    name: "Charged Keyboard",
    category: "KEYBOARD",
    lockerBayNumber: 2,
    batteryPercent: 90,
  }),
  makeItem({
    id: "wired",
    name: "Wired Monitor",
    category: "MONITOR",
    lockerBayNumber: 3,
  }),
];

describe("PeripheralLockerGrid battery status", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true, inventory }),
    }) as unknown as typeof fetch;
  });

  it("shows a battery indicator only for devices with a battery reading", async () => {
    render(<PeripheralLockerGrid />);
    await screen.findByText("Low Battery Mouse");

    const indicators = screen.getAllByTestId("battery-indicator");
    expect(indicators).toHaveLength(2);
    expect(indicators[0]).toHaveAttribute("data-level", "low");
    expect(indicators[0]).toHaveTextContent("15%");
    expect(indicators[1]).toHaveAttribute("data-level", "good");
    expect(indicators[1]).toHaveTextContent("90%");
  });

  it("warns when a device below 20% is requested", async () => {
    render(<PeripheralLockerGrid />);
    await screen.findByText("Low Battery Mouse");

    fireEvent.click(screen.getAllByRole("button", { name: /borrow gear/i })[0]);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Low Battery Mouse");
    expect(alert).toHaveTextContent("15%");
  });

  it("does not warn for a well-charged device", async () => {
    render(<PeripheralLockerGrid />);
    await screen.findByText("Charged Keyboard");

    fireEvent.click(screen.getAllByRole("button", { name: /borrow gear/i })[1]);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not warn for a device without a battery", async () => {
    render(<PeripheralLockerGrid />);
    await screen.findByText("Wired Monitor");

    fireEvent.click(screen.getAllByRole("button", { name: /borrow gear/i })[2]);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets the user cancel the warning without renting", async () => {
    render(<PeripheralLockerGrid />);
    await screen.findByText("Low Battery Mouse");

    fireEvent.click(screen.getAllByRole("button", { name: /borrow gear/i })[0]);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
