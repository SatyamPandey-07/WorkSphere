import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AvatarCropModal } from "@/components/AvatarCropModal";
import { cropImageToWebP, createCroppedAvatarFile } from "@/lib/avatar-crop";

jest.mock("react-easy-crop", () => {
  return function MockCropper({ onCropComplete }: { onCropComplete: any }) {
    return (
      <div data-testid="mock-cropper">
        <button
          type="button"
          data-testid="mock-crop-trigger"
          onClick={() =>
            onCropComplete(
              { x: 0, y: 0, width: 100, height: 100 },
              { x: 10, y: 10, width: 200, height: 200 }
            )
          }
        >
          Simulate Crop Complete
        </button>
      </div>
    );
  };
});

jest.mock("@/lib/avatar-crop", () => ({
  AVATAR_OUTPUT_SIZE: 512,
  cropImageToWebP: jest.fn(),
  createCroppedAvatarFile: jest.fn(),
}));

describe("AvatarCropModal Component (#6917)", () => {
  const mockOnCancel = jest.fn();
  const mockOnConfirm = jest.fn();
  const defaultProps = {
    imageSource: "data:image/png;base64,mockImageSource",
    originalFileName: "profile.png",
    isOpen: true,
    isProcessing: false,
    onCancel: mockOnCancel,
    onConfirm: mockOnConfirm,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when isOpen is false", () => {
    const { container } = render(
      <AvatarCropModal {...defaultProps} isOpen={false} />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("avatar-crop-dialog")).not.toBeInTheDocument();
  });

  it("renders dialog elements when isOpen is true", () => {
    render(<AvatarCropModal {...defaultProps} />);

    expect(screen.getByTestId("avatar-crop-backdrop")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-crop-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-crop-title")).toHaveTextContent("Crop profile picture");
    expect(screen.getByTestId("avatar-crop-description")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-crop-close-btn")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-crop-aspect-preset-1:1")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("avatar-crop-aspect-preset-4:3")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("avatar-crop-aspect-preset-16:9")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("avatar-crop-cropper-container")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-crop-zoom-value")).toHaveTextContent("1.0×");
    expect(screen.getByTestId("avatar-crop-zoom-slider")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-crop-cancel-btn")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-crop-confirm-btn")).toBeInTheDocument();
  });

  it("calls onCancel when close button or Cancel button is clicked", () => {
    render(<AvatarCropModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId("avatar-crop-close-btn"));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("avatar-crop-cancel-btn"));
    expect(mockOnCancel).toHaveBeenCalledTimes(2);
  });

  it("calls onCancel when Escape key is pressed (and not processing)", () => {
    render(<AvatarCropModal {...defaultProps} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel on Escape when isProcessing is true", () => {
    render(<AvatarCropModal {...defaultProps} isProcessing={true} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when clicking on the backdrop overlay", () => {
    render(<AvatarCropModal {...defaultProps} />);

    const backdrop = screen.getByTestId("avatar-crop-backdrop");
    fireEvent.mouseDown(backdrop);
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel when clicking inside the dialog", () => {
    render(<AvatarCropModal {...defaultProps} />);

    const dialog = screen.getByTestId("avatar-crop-dialog");
    fireEvent.mouseDown(dialog);
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it("switches aspect ratio preset and updates aria-pressed", () => {
    render(<AvatarCropModal {...defaultProps} />);

    const preset169 = screen.getByTestId("avatar-crop-aspect-preset-16:9");
    fireEvent.click(preset169);

    expect(preset169).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("avatar-crop-aspect-preset-1:1")).toHaveAttribute("aria-pressed", "false");
  });

  it("adjusts zoom level via buttons and slider within min and max boundaries", () => {
    render(<AvatarCropModal {...defaultProps} />);

    const zoomInBtn = screen.getByTestId("avatar-crop-zoom-in-btn");
    const zoomOutBtn = screen.getByTestId("avatar-crop-zoom-out-btn");
    const zoomSlider = screen.getByTestId("avatar-crop-zoom-slider");

    // Initially zoom is 1.0, zoomOut should be disabled
    expect(zoomOutBtn).toBeDisabled();

    // Click zoom in
    fireEvent.click(zoomInBtn);
    expect(screen.getByTestId("avatar-crop-zoom-value")).toHaveTextContent("1.1×");
    expect(zoomOutBtn).not.toBeDisabled();

    // Click zoom out
    fireEvent.click(zoomOutBtn);
    expect(screen.getByTestId("avatar-crop-zoom-value")).toHaveTextContent("1.0×");

    // Slider change
    fireEvent.change(zoomSlider, { target: { value: "2.5" } });
    expect(screen.getByTestId("avatar-crop-zoom-value")).toHaveTextContent("2.5×");
  });

  it("confirms crop and invokes onConfirm callback with created file", async () => {
    const mockBlob = new Blob(["mockWebPData"], { type: "image/webp" });
    const mockFile = new File([mockBlob], "profile.webp", { type: "image/webp" });

    (cropImageToWebP as jest.Mock).mockResolvedValueOnce(mockBlob);
    (createCroppedAvatarFile as jest.Mock).mockReturnValueOnce(mockFile);

    render(<AvatarCropModal {...defaultProps} />);

    // Trigger mock crop complete to set croppedPixels
    fireEvent.click(screen.getByTestId("mock-crop-trigger"));

    // Confirm button should now be enabled
    const confirmBtn = screen.getByTestId("avatar-crop-confirm-btn");
    expect(confirmBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(cropImageToWebP).toHaveBeenCalledWith(
      "data:image/png;base64,mockImageSource",
      { x: 10, y: 10, width: 200, height: 200 },
      512
    );
    expect(createCroppedAvatarFile).toHaveBeenCalledWith(mockBlob, "profile.png");
    expect(mockOnConfirm).toHaveBeenCalledWith(mockFile);
  });

  it("displays error message when cropImageToWebP throws an error", async () => {
    (cropImageToWebP as jest.Mock).mockRejectedValueOnce(
      new Error("Failed to process canvas export")
    );

    render(<AvatarCropModal {...defaultProps} />);

    // Simulate crop completion
    fireEvent.click(screen.getByTestId("mock-crop-trigger"));

    const confirmBtn = screen.getByTestId("avatar-crop-confirm-btn");
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    const errorMsg = screen.getByTestId("avatar-crop-error-msg");
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveTextContent("Failed to process canvas export");
  });

  it("renders uploading spinner and disabled buttons when isProcessing is true", () => {
    render(<AvatarCropModal {...defaultProps} isProcessing={true} />);

    expect(screen.getByTestId("avatar-crop-confirm-btn")).toHaveTextContent("Uploading...");
    expect(screen.getByTestId("avatar-crop-confirm-btn")).toBeDisabled();
    expect(screen.getByTestId("avatar-crop-cancel-btn")).toBeDisabled();
    expect(screen.getByTestId("avatar-crop-close-btn")).toBeDisabled();
  });
});
