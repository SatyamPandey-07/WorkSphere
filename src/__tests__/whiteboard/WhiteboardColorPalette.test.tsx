import React from "react";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import { WHITEBOARD_COLOR_SWATCHES } from "@/hooks/useCanvasWhiteboard";
import { CanvasToolbar } from "@/components/whiteboard/CanvasToolbar";

describe("Whiteboard Color Palette Picker (#5386)", () => {
  const defaultProps = {
    tool: "pen" as const,
    color: "#000000",
    strokeWidth: 3,
    canUndo: false,
    canRedo: false,
    isConnected: true,
    onToolChange: jest.fn(),
    onColorChange: jest.fn(),
    onStrokeWidthChange: jest.fn(),
    onUndo: jest.fn(),
    onRedo: jest.fn(),
    onClear: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders 8 curated color swatches in WHITEBOARD_COLOR_SWATCHES", () => {
    expect(WHITEBOARD_COLOR_SWATCHES).toHaveLength(8);
    const names = WHITEBOARD_COLOR_SWATCHES.map((s) => s.name);
    expect(names).toEqual([
      "Black",
      "Indigo",
      "Blue",
      "Emerald",
      "Amber",
      "Rose",
      "Purple",
      "Orange",
    ]);
  });

  it("renders color palette radiogroup with 8 swatch buttons and aria labels", () => {
    render(<CanvasToolbar {...defaultProps} />);

    const paletteGroup = screen.getByTestId("color-palette-picker");
    expect(paletteGroup).toBeDefined();
    expect(paletteGroup.getAttribute("role")).toBe("radiogroup");

    WHITEBOARD_COLOR_SWATCHES.forEach((swatch) => {
      const button = screen.getByRole("radio", {
        name: `Select ${swatch.name} color`,
      });
      expect(button).toBeDefined();
      expect(button.getAttribute("aria-label")).toBe(
        `Select ${swatch.name} color`,
      );
    });
  });

  it("highlights currently active color with active border ring indicator and aria-checked=true", () => {
    render(<CanvasToolbar {...defaultProps} color="#6366f1" />); // Indigo

    const indigoButton = screen.getByRole("radio", {
      name: "Select Indigo color",
    });
    expect(indigoButton.getAttribute("aria-checked")).toBe("true");
    expect(indigoButton.className).toContain("scale-110");
    expect(indigoButton.className).toContain("border-2 border-white");

    const blackButton = screen.getByRole("radio", {
      name: "Select Black color",
    });
    expect(blackButton.getAttribute("aria-checked")).toBe("false");
  });

  it("triggers onColorChange callback when a color swatch is clicked", () => {
    const onColorChange = jest.fn();
    render(<CanvasToolbar {...defaultProps} onColorChange={onColorChange} />);

    const emeraldButton = screen.getByRole("radio", {
      name: "Select Emerald color",
    });
    fireEvent.click(emeraldButton);

    expect(onColorChange).toHaveBeenCalledWith("#10b981");
  });

  it("supports keyboard navigation with Enter and Space keys to select color swatches", () => {
    const onColorChange = jest.fn();
    render(<CanvasToolbar {...defaultProps} onColorChange={onColorChange} />);

    const roseButton = screen.getByRole("radio", {
      name: "Select Rose color",
    });

    fireEvent.keyDown(roseButton, { key: "Enter" });
    expect(onColorChange).toHaveBeenCalledWith("#f43f5e");

    fireEvent.keyDown(roseButton, { key: " " });
    expect(onColorChange).toHaveBeenCalledWith("#f43f5e");
  });
});
