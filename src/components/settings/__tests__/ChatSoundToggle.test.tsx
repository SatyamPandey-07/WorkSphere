import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ChatSoundToggle,
  SONIC_BOOM_STORAGE_KEY,
  isSonicBoomEnabled,
  setSonicBoomEnabled,
} from "../ChatSoundToggle";

describe("ChatSoundToggle - Supersonic Sonic Boom Audio FX (#6298)", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("loads default disabled sonic boom preference when unset in localStorage", () => {
    render(<ChatSoundToggle />);
    const toggle = screen.getByTestId("sonic-boom-toggle-switch");
    expect(toggle).not.toBeChecked();
    expect(isSonicBoomEnabled()).toBe(false);
  });

  it("loads enabled sonic boom preference when set in localStorage", () => {
    localStorage.setItem(SONIC_BOOM_STORAGE_KEY, "true");
    render(<ChatSoundToggle />);
    const toggle = screen.getByTestId("sonic-boom-toggle-switch");
    expect(toggle).toBeChecked();
    expect(isSonicBoomEnabled()).toBe(true);
  });

  it("handles toggling switch and persists state to localStorage", () => {
    const handleSonicBoomChange = jest.fn();
    render(<ChatSoundToggle onSonicBoomChange={handleSonicBoomChange} />);

    const toggle = screen.getByTestId("sonic-boom-toggle-switch");
    expect(toggle).not.toBeChecked();

    // Toggle ON
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(localStorage.getItem(SONIC_BOOM_STORAGE_KEY)).toBe("true");
    expect(handleSonicBoomChange).toHaveBeenCalledWith(true);

    // Toggle OFF
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem(SONIC_BOOM_STORAGE_KEY)).toBe("false");
    expect(handleSonicBoomChange).toHaveBeenCalledWith(false);
  });

  it("updates state via helper functions setSonicBoomEnabled", () => {
    expect(isSonicBoomEnabled()).toBe(false);
    setSonicBoomEnabled(true);
    expect(isSonicBoomEnabled()).toBe(true);
    expect(localStorage.getItem(SONIC_BOOM_STORAGE_KEY)).toBe("true");

    setSonicBoomEnabled(false);
    expect(isSonicBoomEnabled()).toBe(false);
    expect(localStorage.getItem(SONIC_BOOM_STORAGE_KEY)).toBe("false");
  });
});
