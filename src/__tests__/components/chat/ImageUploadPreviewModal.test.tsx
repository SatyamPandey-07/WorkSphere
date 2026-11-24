/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ImageUploadPreviewModal,
  calculateRotatedDimensions,
} from "@/components/chat/ImageUploadPreviewModal";

describe("ImageUploadPreviewModal (#10006 & #10016)", () => {
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => "blob:mock-preview-url");
    global.URL.revokeObjectURL = jest.fn();
    HTMLCanvasElement.prototype.getContext = jest.fn(
      () =>
        ({
          clearRect: jest.fn(),
          save: jest.fn(),
          restore: jest.fn(),
          translate: jest.fn(),
          rotate: jest.fn(),
          drawImage: jest.fn(),
        } as any)
    );
    HTMLCanvasElement.prototype.toBlob = jest.fn(function (callback) {
      callback(new Blob(["mock-blob"], { type: "image/jpeg" }));
    });
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

    it("swaps preview canvas width and height and preserves aspect ratio when rotated 90 degrees", () => {
      render(
        <ImageUploadPreviewModal
          isOpen={true}
          imageUrl="http://example.com/photo.jpg"
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />
      );

      // Simulate natural image load with 4:3 dimensions (800x600)
      const img = screen.getByTestId("preview-source-image");
      Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
      fireEvent.load(img);

      const container = screen.getByTestId("image-preview-container");
      expect(container).toHaveAttribute("data-swapped", "false");
      expect(container.style.aspectRatio).toBe("800 / 600");

      const canvas = screen.getByTestId("preview-canvas");
      expect(canvas).toHaveAttribute("data-target-width", "800");
      expect(canvas).toHaveAttribute("data-target-height", "600");

      // Rotate 90° CW
      const rotateCwBtn = screen.getByTestId("rotate-cw-button");
      fireEvent.click(rotateCwBtn);

      expect(container).toHaveAttribute("data-swapped", "true");
      expect(container.style.aspectRatio).toBe("600 / 800");
      expect(canvas).toHaveAttribute("data-target-width", "600");
      expect(canvas).toHaveAttribute("data-target-height", "800");
    });

    it("exports rotated dimensions upon confirmation", async () => {
      const onConfirm = jest.fn();
      render(
        <ImageUploadPreviewModal
          isOpen={true}
          imageUrl="http://example.com/photo.jpg"
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />
      );

      const img = screen.getByTestId("preview-source-image");
      Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
      fireEvent.load(img);

      // Rotate 90° CW
      fireEvent.click(screen.getByTestId("rotate-cw-button"));

      // Confirm upload
      const confirmBtn = screen.getByTestId("confirm-upload-button");
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalled();
      });

      const payload = onConfirm.mock.calls[0][0];
      expect(payload.width).toBe(600);
      expect(payload.height).toBe(800);
      expect(payload.rotation).toBe(90);
    });
  });
});
