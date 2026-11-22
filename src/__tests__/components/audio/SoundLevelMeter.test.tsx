import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SoundLevelMeter } from "@/components/audio/SoundLevelMeter";

describe("SoundLevelMeter Component", () => {
  it("renders sound level decibels and acoustic tier correctly", () => {
    render(<SoundLevelMeter decibels={45} />);

    expect(screen.getByTestId("sound-level-meter")).toHaveAttribute("data-tier", "QUIET");
    expect(screen.getAllByText("Quiet: 45dB").length).toBeGreaterThan(0);
  });

  it("renders filter preset dropdown with all three presets", () => {
    render(<SoundLevelMeter decibels={65} />);

    const select = screen.getByTestId("acoustic-filter-select") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("off");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "off",
      "voice-focus",
      "cafe-suppress",
    ]);
  });

  it("handles filter preset change and invokes callback", () => {
    const onFilterPresetChange = jest.fn();
    render(
      <SoundLevelMeter
        decibels={65}
        onFilterPresetChange={onFilterPresetChange}
      />
    );

    const select = screen.getByTestId("acoustic-filter-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "voice-focus" } });

    expect(select.value).toBe("voice-focus");
    expect(onFilterPresetChange).toHaveBeenCalledWith("voice-focus");

    fireEvent.change(select, { target: { value: "cafe-suppress" } });
    expect(select.value).toBe("cafe-suppress");
    expect(onFilterPresetChange).toHaveBeenCalledWith("cafe-suppress");
  });

  it("respects controlled filterPreset prop", () => {
    const { rerender } = render(
      <SoundLevelMeter decibels={65} filterPreset="voice-focus" />
    );

    const select = screen.getByTestId("acoustic-filter-select") as HTMLSelectElement;
    expect(select.value).toBe("voice-focus");

    rerender(<SoundLevelMeter decibels={65} filterPreset="cafe-suppress" />);
    expect(select.value).toBe("cafe-suppress");
  });

  it("toggles high-contrast mode when toggle button is clicked", () => {
    const onToggle = jest.fn();
    render(
      <SoundLevelMeter
        decibels={76}
        showToggle
        highContrast={false}
        onToggleHighContrast={onToggle}
      />
    );

    const toggle = screen.getByTestId("high-contrast-toggle");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
