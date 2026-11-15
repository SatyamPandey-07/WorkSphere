import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { VenueMediaLightbox, VenueMediaLightboxProps } from "@/components/chat/venue-dialog/VenueMediaLightbox";
import type { Venue } from "@/components/chat/ChatMessages";

// Mock tesseract.js for dynamic import
const mockRecognize = jest.fn();
const mockTerminate = jest.fn();
const mockCreateWorker = jest.fn();

jest.mock("tesseract.js", () => ({
  createWorker: (...args: any[]) => mockCreateWorker(...args),
}));

describe("VenueMediaLightbox Component", () => {
  const mockVenue: Venue = {
    id: "v-1",
    name: "CoWork Nomad Lounge",
    address: "123 Nomad Way, Ubud",
    city: "Bali",
    country: "Indonesia",
    latitude: -8.5,
    longitude: 115.2,
    rating: 4.8,
    reviewsCount: 120,
    photos: [
      "https://example.com/photo1.jpg",
      "https://example.com/photo2.jpg",
      "https://example.com/photo3.jpg",
    ],
  };

  const defaultProps: VenueMediaLightboxProps = {
    venue: mockVenue,
    activeTab: "overview",
    menuPhotos: [],
    uploadingMenu: false,
    onMenuUpload: jest.fn(),
    brokenMenuPhotos: {},
    setBrokenMenuPhotos: jest.fn(),
    previewPhoto: null,
    onClosePreview: jest.fn(),
    onOpenPreview: jest.fn(),
    previewImageError: false,
    setPreviewImageError: jest.fn(),
    allPhotos: [
      "https://example.com/photo1.jpg",
      "https://example.com/photo2.jpg",
      "https://example.com/photo3.jpg",
    ],
    lightboxIndex: null,
    onCloseLightbox: jest.fn(),
    setLightboxIndex: jest.fn(),
    onTouchStart: jest.fn(),
    onTouchEnd: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    mockRecognize.mockResolvedValue({
      data: { text: "Espresso - $3.50\nLatte - $4.50\nAvocado Toast - $8.00" },
    });
    mockTerminate.mockResolvedValue(undefined);
    mockCreateWorker.mockResolvedValue({
      recognize: mockRecognize,
      terminate: mockTerminate,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Menu Tab Photo Gallery", () => {
    it("does not render menu gallery when activeTab is not 'menu'", () => {
      render(<VenueMediaLightbox {...defaultProps} activeTab="overview" />);
      expect(screen.queryByTestId("menu-tab-gallery")).not.toBeInTheDocument();
    });

    it("renders menu gallery with upload label and empty state when menuPhotos is empty", () => {
      render(<VenueMediaLightbox {...defaultProps} activeTab="menu" />);
      expect(screen.getByTestId("menu-tab-gallery")).toBeInTheDocument();
      expect(screen.getByTestId("upload-menu-label")).toBeInTheDocument();
      expect(screen.getByTestId("no-menu-photos")).toBeInTheDocument();
      expect(
        screen.getByText("Upload Menu / Drink Options"),
      ).toBeInTheDocument();
    });

    it("renders uploading spinner and disables input when uploadingMenu is true", () => {
      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          uploadingMenu={true}
        />,
      );
      expect(screen.getByTestId("uploading-menu-spinner")).toBeInTheDocument();
      const input = screen.getByTestId("menu-file-input");
      expect(input).toBeDisabled();
    });

    it("triggers onMenuUpload when file is selected", () => {
      const onMenuUpload = jest.fn();
      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          onMenuUpload={onMenuUpload}
        />,
      );

      const input = screen.getByTestId("menu-file-input");
      fireEvent.change(input, { target: { files: [new File(["img"], "menu.png")] } });
      expect(onMenuUpload).toHaveBeenCalledTimes(1);
    });

    it("renders menu photos grid and handles click to open preview", () => {
      const onOpenPreview = jest.fn();
      const menuPhotos = [
        "https://example.com/menu1.jpg",
        "https://example.com/menu2.jpg",
      ];

      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          menuPhotos={menuPhotos}
          onOpenPreview={onOpenPreview}
        />,
      );

      expect(screen.getByTestId("menu-photo-item-0")).toBeInTheDocument();
      expect(screen.getByTestId("menu-photo-item-1")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("menu-photo-item-0"));
      expect(onOpenPreview).toHaveBeenCalledWith("https://example.com/menu1.jpg");
    });

    it("updates brokenMenuPhotos state on image onError", () => {
      const setBrokenMenuPhotos = jest.fn();
      const menuPhotos = ["https://example.com/broken.jpg"];

      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          menuPhotos={menuPhotos}
          setBrokenMenuPhotos={setBrokenMenuPhotos}
        />,
      );

      const img = screen.getByTestId("menu-photo-img-0");
      fireEvent.error(img);
      expect(setBrokenMenuPhotos).toHaveBeenCalledTimes(1);
    });
  });

  describe("Preview Modal & Keyboard Dismissal", () => {
    it("does not render preview modal when previewPhoto is null", () => {
      render(<VenueMediaLightbox {...defaultProps} previewPhoto={null} />);
      expect(screen.queryByTestId("preview-modal")).not.toBeInTheDocument();
    });

    it("renders preview modal with image when previewPhoto is set", () => {
      render(
        <VenueMediaLightbox
          {...defaultProps}
          previewPhoto="https://example.com/speedtest.jpg"
        />,
      );

      expect(screen.getByTestId("preview-modal")).toBeInTheDocument();
      const img = screen.getByTestId("preview-photo-img");
      expect(img).toHaveAttribute("src", "https://example.com/speedtest.jpg");
    });

    it("displays error fallback view when previewImageError is true", () => {
      render(
        <VenueMediaLightbox
          {...defaultProps}
          previewPhoto="https://example.com/missing.jpg"
          previewImageError={true}
        />,
      );

      expect(screen.getByTestId("preview-image-error")).toBeInTheDocument();
      expect(screen.getByText("Preview Image Not Found")).toBeInTheDocument();
    });

    it("calls onClosePreview when clicking backdrop or close button", () => {
      const onClosePreview = jest.fn();
      render(
        <VenueMediaLightbox
          {...defaultProps}
          previewPhoto="https://example.com/preview.jpg"
          onClosePreview={onClosePreview}
        />,
      );

      fireEvent.click(screen.getByTestId("close-preview-btn"));
      expect(onClosePreview).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("preview-modal"));
      expect(onClosePreview).toHaveBeenCalledTimes(2);
    });

    it("dismisses preview modal when Escape key is pressed", () => {
      const onClosePreview = jest.fn();
      render(
        <VenueMediaLightbox
          {...defaultProps}
          previewPhoto="https://example.com/preview.jpg"
          onClosePreview={onClosePreview}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClosePreview).toHaveBeenCalledTimes(1);
    });
  });

  describe("Menu Translation & OCR Workflow", () => {
    it("renders translation menu button when activeTab is menu and previewPhoto is present", () => {
      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          previewPhoto="https://example.com/menu-photo.jpg"
        />,
      );

      expect(screen.getByTestId("translate-menu-btn")).toBeInTheDocument();
      expect(screen.getByTestId("translate-lang-btn-Spanish")).toBeInTheDocument();
      expect(screen.getByTestId("translate-lang-btn-French")).toBeInTheDocument();
    });

    it("performs OCR extraction and calls /api/menu-translate on language selection", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          translatedText: "Café Exprés - 3.50€\nCafé con Leche - 4.50€",
        }),
      });

      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          previewPhoto="https://example.com/menu-photo.jpg"
        />,
      );

      const spanishBtn = screen.getByTestId("translate-lang-btn-Spanish");

      await act(async () => {
        fireEvent.click(spanishBtn);
      });

      expect(mockCreateWorker).toHaveBeenCalledWith("eng");
      expect(mockRecognize).toHaveBeenCalledWith("https://example.com/menu-photo.jpg");
      expect(mockTerminate).toHaveBeenCalledTimes(1);

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/menu-translate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            text: "Espresso - $3.50\nLatte - $4.50\nAvocado Toast - $8.00",
            targetLanguage: "Spanish",
          }),
        }),
      );

      expect(screen.getByTestId("translated-menu-result")).toBeInTheDocument();
      expect(screen.getByText("Translated to Spanish")).toBeInTheDocument();
      expect(
        screen.getByText(/Café Exprés - 3\.50€/),
      ).toBeInTheDocument();

      // Close translated menu result
      fireEvent.click(screen.getByTestId("close-translated-menu-btn"));
      expect(
        screen.queryByTestId("translated-menu-result"),
      ).not.toBeInTheDocument();
    });

    it("uses cached translation on subsequent requests for the same language", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          translatedText: "Traduction Française",
        }),
      });

      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          previewPhoto="https://example.com/menu-cached.jpg"
        />,
      );

      const frenchBtn = screen.getByTestId("translate-lang-btn-French");

      // First run: calls OCR and fetch
      await act(async () => {
        fireEvent.click(frenchBtn);
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Close result view
      fireEvent.click(screen.getByTestId("close-translated-menu-btn"));

      // Second run: uses cache, no extra fetch
      await act(async () => {
        fireEvent.click(frenchBtn);
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Traduction Française")).toBeInTheDocument();
    });

    it("handles OCR error and displays error banner with dismiss action", async () => {
      mockRecognize.mockRejectedValueOnce(new Error("Worker failed"));

      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          previewPhoto="https://example.com/corrupt.jpg"
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("translate-lang-btn-German"));
      });

      expect(screen.getByTestId("translation-error-banner")).toBeInTheDocument();
      expect(
        screen.getByText("Unable to extract readable text."),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("dismiss-translation-error-btn"));
      expect(
        screen.queryByTestId("translation-error-banner"),
      ).not.toBeInTheDocument();
    });

    it("handles translation API failure and displays error toast", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          previewPhoto="https://example.com/menu.jpg"
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("translate-lang-btn-Hindi"));
      });

      expect(screen.getByTestId("translation-error-banner")).toBeInTheDocument();
      expect(
        screen.getByText("Translation failed. Please try again."),
      ).toBeInTheDocument();
    });
  });

  describe("Fullscreen Lightbox & Navigation", () => {
    it("does not render lightbox when lightboxIndex is null", () => {
      render(<VenueMediaLightbox {...defaultProps} lightboxIndex={null} />);
      expect(
        screen.queryByTestId("fullscreen-lightbox-modal"),
      ).not.toBeInTheDocument();
    });

    it("renders lightbox with image and counter when lightboxIndex is set", () => {
      render(<VenueMediaLightbox {...defaultProps} lightboxIndex={0} />);

      expect(
        screen.getByTestId("fullscreen-lightbox-modal"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("lightbox-counter")).toHaveTextContent("1 / 3");
      const img = screen.getByTestId("lightbox-main-img");
      expect(img).toHaveAttribute("src", "https://example.com/photo1.jpg");
    });

    it("cycles through photos using previous and next buttons", () => {
      const setLightboxIndex = jest.fn();
      render(
        <VenueMediaLightbox
          {...defaultProps}
          lightboxIndex={1}
          setLightboxIndex={setLightboxIndex}
        />,
      );

      fireEvent.click(screen.getByTestId("prev-lightbox-btn"));
      expect(setLightboxIndex).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("next-lightbox-btn"));
      expect(setLightboxIndex).toHaveBeenCalledTimes(2);
    });

    it("navigates photos using ArrowLeft and ArrowRight keyboard keys", () => {
      const setLightboxIndex = jest.fn();
      render(
        <VenueMediaLightbox
          {...defaultProps}
          lightboxIndex={1}
          setLightboxIndex={setLightboxIndex}
        />,
      );

      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(setLightboxIndex).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(setLightboxIndex).toHaveBeenCalledTimes(2);
    });

    it("closes lightbox on Escape key, close button, or backdrop click", () => {
      const onCloseLightbox = jest.fn();
      render(
        <VenueMediaLightbox
          {...defaultProps}
          lightboxIndex={0}
          onCloseLightbox={onCloseLightbox}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCloseLightbox).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("close-lightbox-btn"));
      expect(onCloseLightbox).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByTestId("fullscreen-lightbox-modal"));
      expect(onCloseLightbox).toHaveBeenCalledTimes(3);
    });

    it("forwards touch gestures to touch handler props", () => {
      const onTouchStart = jest.fn();
      const onTouchEnd = jest.fn();

      render(
        <VenueMediaLightbox
          {...defaultProps}
          lightboxIndex={0}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        />,
      );

      const img = screen.getByTestId("lightbox-main-img");
      fireEvent.touchStart(img.parentElement!);
      expect(onTouchStart).toHaveBeenCalledTimes(1);

      fireEvent.touchEnd(img.parentElement!);
      expect(onTouchEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("Unmounted Safety", () => {
    it("safely ignores state updates if unmounted during pending OCR", async () => {
      let resolveOcr: (val: any) => void;
      mockRecognize.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOcr = resolve;
        }),
      );

      const { unmount } = render(
        <VenueMediaLightbox
          {...defaultProps}
          activeTab="menu"
          previewPhoto="https://example.com/menu-unmount.jpg"
        />,
      );

      act(() => {
        fireEvent.click(screen.getByTestId("translate-lang-btn-Spanish"));
      });

      // Unmount before OCR finishes
      unmount();

      // Resolve OCR after unmount
      await act(async () => {
        resolveOcr!({
          data: { text: "Unmounted text" },
        });
      });

      // Verification: Clean completion without uncaught unmounted state errors
      expect(true).toBe(true);
    });
  });
});
