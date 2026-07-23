import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock useGodRaysRenderer
const mockCanvas = document.createElement("canvas");
jest.mock("@/hooks/useGodRaysRenderer", () => ({
  useGodRaysRenderer: jest.fn(() => ({
    isSupported: true,
    fps: 60,
    canvas: mockCanvas,
  })),
}));

jest.mock("@/lib/sunPosition", () => ({
  calculateSunPosition: jest.fn(() => ({
    azimuth: 120,
    altitude: 15,
    isAboveHorizon: true,
  })),
}));

import { VenueGodRays } from "@/components/VenueGodRays";
import { useGodRaysRenderer } from "@/hooks/useGodRaysRenderer";

const STORAGE_KEY = "worksphere:godrays:enabled";
const DENSITY_KEY = "worksphere:godrays:density";

describe("VenueGodRays Toggle (#1268)", () => {
  let localStorageStore: Record<string, string>;

  beforeEach(() => {
    localStorageStore = {};
    Storage.prototype.getItem = jest.fn((key: string) => localStorageStore[key] ?? null);
    Storage.prototype.setItem = jest.fn((key: string, value: string) => {
      localStorageStore[key] = value;
    });
    jest.clearAllMocks();
  });

  it("renders the ON toggle button by default", () => {
    render(<VenueGodRays />);
    const toggle = screen.getByTitle("Disable volumetric rendering");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent("ON");
  });

  it("passes animate=true to useGodRaysRenderer by default", () => {
    render(<VenueGodRays />);
    const hook = useGodRaysRenderer as jest.Mock;
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ animate: true }),
    );
  });

  it("toggles to OFF when clicked", () => {
    render(<VenueGodRays />);
    const toggle = screen.getByTitle("Disable volumetric rendering");
    fireEvent.click(toggle);

    expect(screen.getByTitle("Enable volumetric rendering")).toHaveTextContent("OFF");
  });

  it("passes animate=false to useGodRaysRenderer when OFF", () => {
    render(<VenueGodRays />);
    const toggle = screen.getByTitle("Disable volumetric rendering");
    fireEvent.click(toggle);

    const hook = useGodRaysRenderer as jest.Mock;
    const lastCall = hook.mock.calls[hook.mock.calls.length - 1][0];
    expect(lastCall.animate).toBe(false);
  });

  it("saves enabled state to localStorage", () => {
    render(<VenueGodRays />);
    const toggle = screen.getByTitle("Disable volumetric rendering");
    fireEvent.click(toggle);

    expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "false");
  });

  it("reads enabled state from localStorage on mount", () => {
    localStorageStore[STORAGE_KEY] = "false";

    render(<VenueGodRays />);
    expect(screen.getByTitle("Enable volumetric rendering")).toHaveTextContent("OFF");
  });

  it("defaults to enabled when localStorage has no entry", () => {
    render(<VenueGodRays />);
    expect(screen.getByTitle("Disable volumetric rendering")).toHaveTextContent("ON");
  });

  it("toggles back to ON after being OFF", () => {
    render(<VenueGodRays />);
    const toggle = screen.getByTitle("Disable volumetric rendering");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTitle("Enable volumetric rendering"));

    expect(screen.getByTitle("Disable volumetric rendering")).toHaveTextContent("ON");
    expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "true");
  });

  it("renders the eye icons for ON/OFF states", () => {
    render(<VenueGodRays />);
    // ON state shows Eye icon (not EyeOff)
    const toggle = screen.getByTitle("Disable volumetric rendering");
    expect(toggle.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(toggle);
    const offToggle = screen.getByTitle("Enable volumetric rendering");
    expect(offToggle.querySelector("svg")).toBeInTheDocument();
  });

  it("passes default density=4.0 to useGodRaysRenderer", () => {
    render(<VenueGodRays />);
    const hook = useGodRaysRenderer as jest.Mock;
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ density: 4.0 }),
    );
  });

  it("renders a density range input", () => {
    render(<VenueGodRays />);
    const slider = screen.getByTitle(/Ray density/);
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute("type", "range");
  });

  it("displays default density percentage as 40%", () => {
    render(<VenueGodRays />);
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("displays 0% when density slider is set to 0", () => {
    render(<VenueGodRays />);
    const slider = screen.getByTitle(/Ray density/);
    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
  });

  it("does not display NaN% for any slider position", () => {
    render(<VenueGodRays />);
    const slider = screen.getByTitle(/Ray density/);
    [0, 1, 2, 5, 10].forEach((val) => {
      fireEvent.change(slider, { target: { value: String(val) } });
      expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
    });
  });

  it("updates density in useGodRaysRenderer when slider changes", () => {
    render(<VenueGodRays />);
    const slider = screen.getByTitle(/Ray density/);
    fireEvent.change(slider, { target: { value: "7.5" } });
    const hook = useGodRaysRenderer as jest.Mock;
    const lastCall = hook.mock.calls[hook.mock.calls.length - 1][0];
    expect(lastCall.density).toBe(7.5);
  });

  it("clamps density to MAX_DENSITY (10) when exceeded", () => {
    render(<VenueGodRays />);
    const slider = screen.getByTitle(/Ray density/);
    fireEvent.change(slider, { target: { value: "15" } });
    const hook = useGodRaysRenderer as jest.Mock;
    const lastCall = hook.mock.calls[hook.mock.calls.length - 1][0];
    expect(lastCall.density).toBeLessThanOrEqual(10);
  });

  it("saves density to localStorage on change", () => {
    render(<VenueGodRays />);
    const slider = screen.getByTitle(/Ray density/);
    fireEvent.change(slider, { target: { value: "3.5" } });
    expect(localStorage.setItem).toHaveBeenCalledWith(DENSITY_KEY, "3.5");
  });

  it("restores density from localStorage on mount", () => {
    localStorageStore[DENSITY_KEY] = "8";
    render(<VenueGodRays />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    const hook = useGodRaysRenderer as jest.Mock;
    const lastCall = hook.mock.calls[hook.mock.calls.length - 1][0];
    expect(lastCall.density).toBe(8);
  });

  it("ignores invalid NaN density in localStorage", () => {
    localStorageStore[DENSITY_KEY] = "NaN";
    render(<VenueGodRays />);
    expect(screen.getByText("40%")).toBeInTheDocument();
    const hook = useGodRaysRenderer as jest.Mock;
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ density: 4.0 }),
    );
  });
});
