import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FolderColorPicker,
  getContrastTextColor,
  PRESET_FOLDER_COLORS,
} from "@/components/collections/FolderColorPicker";

describe("getContrastTextColor utility", () => {
  it("returns black (#000000) for bright / light colors", () => {
    expect(getContrastTextColor("#ffffff")).toBe("#000000");
    expect(getContrastTextColor("#fef08a")).toBe("#000000");
    expect(getContrastTextColor("#e2e8f0")).toBe("#000000");
  });

  it("returns white (#ffffff) for dark / deep colors", () => {
    expect(getContrastTextColor("#000000")).toBe("#ffffff");
    expect(getContrastTextColor("#1e293b")).toBe("#ffffff");
    expect(getContrastTextColor("#3b82f6")).toBe("#ffffff");
    expect(getContrastTextColor("#6366f1")).toBe("#ffffff");
  });

  it("correctly expands 3-digit shorthand hex colors", () => {
    expect(getContrastTextColor("#fff")).toBe("#000000");
    expect(getContrastTextColor("#000")).toBe("#ffffff");
  });

  it("handles nullish, empty, or malformed hex values gracefully without throwing", () => {
    expect(getContrastTextColor(null)).toBe("#ffffff");
    expect(getContrastTextColor(undefined)).toBe("#ffffff");
    expect(getContrastTextColor("")).toBe("#ffffff");
    expect(getContrastTextColor("not-a-hex")).toBe("#ffffff");
    expect(getContrastTextColor("#12")).toBe("#ffffff");
  });
});

describe("FolderColorPicker Component", () => {
  it("renders all preset swatches and custom input", () => {
    render(
      <FolderColorPicker
        selectedColor="#3b82f6"
        onChange={jest.fn()}
        testId="color-picker"
      />
    );

    expect(screen.getByTestId("color-picker")).toBeInTheDocument();
    expect(screen.getByTestId("color-picker-label")).toHaveTextContent("Workspace Tag Color");

    // All presets rendered
    PRESET_FOLDER_COLORS.forEach((preset) => {
      const slug = preset.name.toLowerCase();
      expect(screen.getByTestId(`color-picker-swatch-${slug}`)).toBeInTheDocument();
    });

    // Checkmark displayed on selected color (#3b82f6 -> Blue)
    expect(screen.getByTestId("color-picker-checkmark")).toBeInTheDocument();
    expect(screen.getByTestId("color-picker-hex-value")).toHaveTextContent("#3b82f6");
  });

  it("calls onChange when a preset color swatch is clicked", () => {
    const onChange = jest.fn();

    render(
      <FolderColorPicker
        selectedColor="#3b82f6"
        onChange={onChange}
        testId="color-picker"
      />
    );

    // Click Emerald swatch
    const emeraldBtn = screen.getByTestId("color-picker-swatch-emerald");
    fireEvent.click(emeraldBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("#10b981");
  });

  it("calls onChange when custom color input changes", () => {
    const onChange = jest.fn();

    render(
      <FolderColorPicker
        selectedColor="#3b82f6"
        onChange={onChange}
        testId="color-picker"
      />
    );

    const input = screen.getByTestId("color-picker-custom-input");
    fireEvent.change(input, { target: { value: "#123456" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("#123456");
  });

  it("handles custom label and associates htmlFor with input id", () => {
    render(
      <FolderColorPicker
        selectedColor="#ec4899"
        onChange={jest.fn()}
        label="Folder Accent"
        id="folder-accent-id"
        testId="color-picker"
      />
    );

    const label = screen.getByTestId("color-picker-label");
    expect(label).toHaveTextContent("Folder Accent");
    expect(label).toHaveAttribute("for", "folder-accent-id");

    const input = screen.getByTestId("color-picker-custom-input");
    expect(input).toHaveAttribute("id", "folder-accent-id");
  });

  it("disables swatches and custom input when disabled prop is true", () => {
    const onChange = jest.fn();

    render(
      <FolderColorPicker
        selectedColor="#3b82f6"
        onChange={onChange}
        disabled={true}
        testId="color-picker"
      />
    );

    const roseBtn = screen.getByTestId("color-picker-swatch-rose");
    expect(roseBtn).toBeDisabled();

    fireEvent.click(roseBtn);
    expect(onChange).not.toHaveBeenCalled();

    const input = screen.getByTestId("color-picker-custom-input");
    expect(input).toBeDisabled();

    fireEvent.change(input, { target: { value: "#ff0000" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gracefully falls back when selectedColor is null or whitespace", () => {
    render(
      <FolderColorPicker
        selectedColor={null}
        onChange={jest.fn()}
        testId="color-picker"
      />
    );

    // Defaults to #3b82f6 (Blue)
    expect(screen.getByTestId("color-picker-hex-value")).toHaveTextContent("#3b82f6");
    expect(screen.getByTestId("color-picker-checkmark")).toBeInTheDocument();
  });
});
