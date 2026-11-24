import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ImageUploadPreviewModal,
  ImageUploadPayload,
} from "@/components/chat/ImageUploadPreviewModal";
import * as imageCompressor from "@/lib/media/imageCompressor";

describe("ImageUploadPreviewModal Component", () => {
  const mockFile = new File(
    ["sample-binary-image-data-string"],
    "desk-view.png",
    {
      type: "image/png",
    },
  );
  const mockOnCancel = jest.fn();
  const mockOnConfirm = jest.fn();

  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeAll(() => {
    originalCreateObjectURL = global.URL.createObjectURL;
    originalRevokeObjectURL = global.URL.revokeObjectURL;
    global.URL.createObjectURL = jest.fn(
      () => "blob:http://localhost/mock-preview-id",
    );
    global.URL.revokeObjectURL = jest.fn();

    // Mock getImageDimensions and compressImage to provide deterministic responses
    jest.spyOn(imageCompressor, "getImageDimensions").mockResolvedValue({
      width: 1920,
      height: 1080,
    });

    jest.spyOn(imageCompressor, "compressImage").mockResolvedValue({
      blob: new Blob(["compressed-image-data"], { type: "image/jpeg" }),
      dataUrl: "data:image/jpeg;base64,mockcompresseddata",
      width: 1920,
      height: 1080,
      sizeBytes: 81920, // 80 KB
      originalSizeBytes: 120000,
      mimeType: "image/jpeg",
    });
  });

  afterAll(() => {
    global.URL.createObjectURL = originalCreateObjectURL;
    global.URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(
      <ImageUploadPreviewModal
        isOpen={false}
        file={mockFile}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );
    expect(
      screen.queryByTestId("image-upload-preview-modal"),
    ).not.toBeInTheDocument();
  });

  it("does not render when file is null", () => {
    render(
      <ImageUploadPreviewModal
        isOpen={true}
        file={null}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );
    expect(
      screen.queryByTestId("image-upload-preview-modal"),
    ).not.toBeInTheDocument();
  });

  it("displays instant high-res preview and output byte size (Acceptance Criteria 1)", async () => {
    render(
      <ImageUploadPreviewModal
        isOpen={true}
        file={mockFile}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );

    // Modal dialog rendered
    expect(
      screen.getByTestId("image-upload-preview-modal"),
    ).toBeInTheDocument();
    expect(screen.getByText("Image Upload Preview")).toBeInTheDocument();
    expect(screen.getByText("desk-view.png")).toBeInTheDocument();

    // Instant preview thumbnail
    const thumbnail = screen.getByTestId("image-preview-thumbnail");
    expect(thumbnail).toBeInTheDocument();
    expect(thumbnail).toHaveAttribute(
      "src",
      "blob:http://localhost/mock-preview-id",
    );

    // Check dimensions displayed
    await waitFor(() => {
      expect(screen.getByTestId("image-dimensions")).toHaveTextContent(
        "1920 × 1080 px",
      );
    });

    // Check estimated output byte size
    await waitFor(() => {
      const payloadSizeEl = screen.getByTestId("image-payload-size");
      expect(payloadSizeEl).toHaveTextContent("80.0 KB");
    });
  });

  it("handles cancellation via close button and cancel button (Acceptance Criteria 3)", async () => {
    render(
      <ImageUploadPreviewModal
        isOpen={true}
        file={mockFile}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );

    await screen.findByTestId("image-dimensions");

    // Click cancel button in footer
    const cancelBtn = screen.getByTestId("cancel-preview-btn");
    fireEvent.click(cancelBtn);
    expect(mockOnCancel).toHaveBeenCalledTimes(1);

    // Click close 'X' button in header
    const closeBtn = screen.getByTestId("close-preview-modal-btn");
    fireEvent.click(closeBtn);
    expect(mockOnCancel).toHaveBeenCalledTimes(2);
  });

  it("supports keyboard control: Esc to cancel (Acceptance Criteria 2)", async () => {
    render(
      <ImageUploadPreviewModal
        isOpen={true}
        file={mockFile}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );

    await screen.findByTestId("image-dimensions");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard control: Enter to upload (Acceptance Criteria 2)", async () => {
    render(
      <ImageUploadPreviewModal
        isOpen={true}
        file={mockFile}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );

    await screen.findByTestId("image-dimensions");

    // Press enter on the window
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    await waitFor(() => {
      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it("allows entering a caption and passes it upon confirmation (Acceptance Criteria 3)", async () => {
    render(
      <ImageUploadPreviewModal
        isOpen={true}
        file={mockFile}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );

    await screen.findByTestId("image-dimensions");

    const captionInput = screen.getByTestId("image-caption-input");
    fireEvent.change(captionInput, {
      target: { value: "Quiet spot near power outlets" },
    });
    expect(captionInput).toHaveValue("Quiet spot near power outlets");

    // Click confirm upload button
    const uploadBtn = screen.getByTestId("confirm-upload-btn");
    await act(async () => {
      fireEvent.click(uploadBtn);
    });

    await waitFor(() => {
      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      const payload: ImageUploadPayload = mockOnConfirm.mock.calls[0][0];
      expect(payload.caption).toBe("Quiet spot near power outlets");
      expect(payload.sizeBytes).toBe(81920);
      expect(payload.dimensions).toEqual({ width: 1920, height: 1080 });
    });
  });

  it("allows rotating the image clockwise", async () => {
    render(
      <ImageUploadPreviewModal
        isOpen={true}
        file={mockFile}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );

    await screen.findByTestId("image-dimensions");

    const rotateBtn = screen.getByTestId("rotate-image-btn");
    expect(rotateBtn).toHaveTextContent("Rotate");

    // Rotate 90 deg
    fireEvent.click(rotateBtn);
    expect(screen.getByTestId("rotate-image-btn")).toHaveTextContent(
      "Rotate (90°)",
    );

    const thumbnail = screen.getByTestId("image-preview-thumbnail");
    expect(thumbnail).toHaveStyle("transform: rotate(90deg)");

    // Dimensions display should reflect rotated orientation (height x width)
    await waitFor(() => {
      expect(screen.getByTestId("image-dimensions")).toHaveTextContent(
        "1080 × 1920 px",
      );
    });
  });

  it("allows switching crop aspect ratio options", async () => {
    render(
      <ImageUploadPreviewModal
        isOpen={true}
        file={mockFile}
        onCancel={mockOnCancel}
        onConfirm={mockOnConfirm}
      />,
    );

    await screen.findByTestId("image-dimensions");

    const squareOption = screen.getByTestId("crop-option-square");
    fireEvent.click(squareOption);
    expect(squareOption).toHaveClass("bg-zinc-700");
    expect(screen.getByTestId("image-dimensions")).toHaveTextContent(
      "1080 × 1080 px",
    );

    const widescreenOption = screen.getByTestId("crop-option-16:9");
    fireEvent.click(widescreenOption);
    expect(widescreenOption).toHaveClass("bg-zinc-700");
  });
});
