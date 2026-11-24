/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ImageUploadPreviewModal,
  calculateRotatedDimensions,
} from "@/components/chat/ImageUploadPreviewModal";

describe("ImageUploadPreviewModal (#10006 & #10016)", () => {
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => "blob:mock-preview-url");
    global.URL.revokeObjectURL = jest.fn();
  });

  describe("calculateRotatedDimensions", () => {
    it("preserves dimensions for 0 and 180 degrees", () => {
      expect(calculateRotatedDimensions(800, 600, 0)).toEqual({
        width: 800,
        height: 600,
        isSwapped: false,
      });
      expect(calculateRotatedDimensions(800, 600, 180)).toEqual({
        width: 800,
        height: 600,
        isSwapped: false,
      });
    });

    it("swaps width and height for 90 and 270 degrees to preserve aspect ratio", () => {
      expect(calculateRotatedDimensions(800, 600, 90)).toEqual({
        width: 600,
        height: 800,
        isSwapped: true,
      });
      expect(calculateRotatedDimensions(800, 600, 270)).toEqual({
        width: 600,
        height: 800,
        isSwapped: true,
      });
    });
  });

  describe("Component Rendering and Accessibility", () => {
    it("renders modal with role dialog and aria attributes", () => {
      render(
        <ImageUploadPreviewModal
          isOpen={true}
          imageUrl="http://example.com/photo.jpg"
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute(
        "aria-labelledby",
        "image-preview-modal-title"
      );
    });

    it("displays keyboard shortcut tooltips on control buttons", () => {
      render(
        <ImageUploadPreviewModal
          isOpen={true}
          imageUrl="http://example.com/photo.jpg"
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />
      );

      const rotateCwBtn = screen.getByTestId("rotate-cw-button");
      expect(rotateCwBtn).toHaveAttribute(
        "aria-label",
        "Rotate clockwise (R)"
      );

      const rotateCcwBtn = screen.getByTestId("rotate-ccw-button");
      expect(rotateCcwBtn).toHaveAttribute(
        "aria-label",
        "Rotate counter-clockwise (Shift + R)"
      );

      const zoomInBtn = screen.getByTestId("zoom-in-button");
      expect(zoomInBtn).toHaveAttribute("aria-label", "Zoom in (+)");

      const zoomOutBtn = screen.getByTestId("zoom-out-button");
      expect(zoomOutBtn).toHaveAttribute("aria-label", "Zoom out (-)");
    });

    it("responds to keyboard events when open", () => {
      const onClose = jest.fn();
      render(
        <ImageUploadPreviewModal
          isOpen={true}
          imageUrl="http://example.com/photo.jpg"
          onClose={onClose}
          onConfirm={jest.fn()}
        />
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });

    it("updates zoom indicator on +/- shortcut events", () => {
      render(
        <ImageUploadPreviewModal
          isOpen={true}
          imageUrl="http://example.com/photo.jpg"
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />
      );

      const indicator = screen.getByTestId("zoom-level-indicator");
      expect(indicator).toHaveTextContent("100%");

      fireEvent.keyDown(window, { key: "+" });
      expect(indicator).toHaveTextContent("125%");

      fireEvent.keyDown(window, { key: "-" });
      expect(indicator).toHaveTextContent("100%");
    });
  });
});
