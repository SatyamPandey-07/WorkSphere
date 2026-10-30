import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import VenueSubmissionModalDefault, {
  VenueSubmissionModal,
} from "@/components/VenueSubmissionModal";

let mockIsSignedIn = true;
const mockGetToken = jest.fn().mockResolvedValue("test-token-123");

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isSignedIn: mockIsSignedIn }),
  useAuth: () => ({ getToken: mockGetToken }),
}));

describe("VenueSubmissionModal Component Suite", () => {
  const mockOnClose = jest.fn();
  const mockOnSubmitSuccess = jest.fn();
  const originalFetch = global.fetch;

  beforeAll(() => {
    if (!global.URL.createObjectURL) {
      global.URL.createObjectURL = jest.fn(() => "blob:mock-image-preview");
    } else {
      jest.spyOn(global.URL, "createObjectURL").mockReturnValue("blob:mock-image-preview");
    }
    if (!global.URL.revokeObjectURL) {
      global.URL.revokeObjectURL = jest.fn();
    } else {
      jest.spyOn(global.URL, "revokeObjectURL").mockImplementation(() => {});
    }

    const mockGeolocation = {
      getCurrentPosition: jest.fn((success) => {
        success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
          },
        });
      }),
    };
    Object.defineProperty(global.navigator, "geolocation", {
      value: mockGeolocation,
      writable: true,
      configurable: true,
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSignedIn = true;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, venue: { id: "new-v-1" } }),
    });
  });

  it("exports default matching named export", () => {
    expect(VenueSubmissionModalDefault).toBe(VenueSubmissionModal);
  });

  it("renders nothing when isOpen is false", () => {
    render(
      <VenueSubmissionModal
        isOpen={false}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    expect(screen.queryByTestId("venue-submission-modal")).not.toBeInTheDocument();
  });

  it("renders modal dialog and header when isOpen is true", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    expect(screen.getByTestId("venue-submission-modal")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /suggest a workspace/i })).toBeInTheDocument();
    expect(screen.getByTestId("venue-submission-close-btn")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    fireEvent.click(screen.getByTestId("venue-submission-close-btn"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    fireEvent.click(screen.getByTestId("venue-submission-backdrop"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key press", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("prevents backdrop click from firing onClose when clicking modal content", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("displays error when user attempts submission while signed out", async () => {
    mockIsSignedIn = false;

    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    const form = screen.getByRole("dialog").querySelector("form");
    expect(form).toBeInTheDocument();
    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(() => {
      expect(screen.getByTestId("venue-submission-error")).toHaveTextContent(
        "Please sign in to suggest a venue"
      );
    });
  });

  it("displays error when venue name is empty on submit", async () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
        userLocation={{ lat: 40.7128, lng: -74.006 }}
      />
    );

    const form = screen.getByRole("dialog").querySelector("form");
    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(() => {
      expect(screen.getByTestId("venue-submission-error")).toHaveTextContent(
        "Venue name is required"
      );
    });
  });

  it("displays error when coordinates are missing on submit", async () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    fireEvent.change(screen.getByTestId("venue-name-input"), {
      target: { value: "Central Perk" },
    });

    const form = screen.getByRole("dialog").querySelector("form");
    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(() => {
      expect(screen.getByTestId("venue-submission-error")).toHaveTextContent(
        "Location coordinates are required"
      );
    });
  });

  it("populates coordinates using userLocation prop when clicking location button", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
        userLocation={{ lat: 12.9716, lng: 77.5946 }}
      />
    );

    fireEvent.click(screen.getByTestId("use-my-location-btn"));

    expect(screen.getByTestId("venue-lat-input")).toHaveValue(12.9716);
    expect(screen.getByTestId("venue-lng-input")).toHaveValue(77.5946);
  });

  it("populates coordinates from navigator.geolocation when userLocation is undefined", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    fireEvent.click(screen.getByTestId("use-my-location-btn"));

    expect(screen.getByTestId("venue-lat-input")).toHaveValue(37.7749);
    expect(screen.getByTestId("venue-lng-input")).toHaveValue(-122.4194);
  });

  it("handles form inputs: category change and manual coordinate typing", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    const categorySelect = screen.getByTestId("venue-category-select");
    fireEvent.change(categorySelect, { target: { value: "coworking" } });
    expect(categorySelect).toHaveValue("coworking");

    const latInput = screen.getByTestId("venue-lat-input");
    fireEvent.change(latInput, { target: { value: "51.5074" } });
    expect(latInput).toHaveValue(51.5074);

    const lngInput = screen.getByTestId("venue-lng-input");
    fireEvent.change(lngInput, { target: { value: "-0.1278" } });
    expect(lngInput).toHaveValue(-0.1278);
  });

  it("rejects invalid file type in image upload", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    const fileInput = screen.getByRole("dialog").querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();

    if (fileInput) {
      const invalidFile = new File(["dummy content"], "doc.pdf", {
        type: "application/pdf",
      });
      fireEvent.change(fileInput, { target: { files: [invalidFile] } });
    }

    expect(screen.getByTestId("venue-submission-error")).toHaveTextContent(
      "Invalid file type. Please upload a JPEG, PNG, or WEBP."
    );
  });

  it("rejects files larger than 5MB", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
      />
    );

    const fileInput = screen.getByRole("dialog").querySelector('input[type="file"]');
    if (fileInput) {
      const largeFile = new File(["a".repeat(100)], "huge.png", {
        type: "image/png",
      });
      Object.defineProperty(largeFile, "size", { value: 6 * 1024 * 1024 });
      fireEvent.change(fileInput, { target: { files: [largeFile] } });
    }

    expect(screen.getByTestId("venue-submission-error")).toHaveTextContent(
      "Image must be smaller than 5MB"
    );
  });

  it("submits form successfully and calls onSubmitSuccess callback", async () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
        userLocation={{ lat: 37.7749, lng: -122.4194 }}
      />
    );

    fireEvent.change(screen.getByTestId("venue-name-input"), {
      target: { value: "Artisan Roasters" },
    });

    const submitBtn = screen.getByTestId("venue-submit-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/venues",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-token-123",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(mockOnSubmitSuccess).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/venue submitted successfully/i)).toBeInTheDocument();
    });
  });

  it("shows error when venue submission API fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Duplicate venue name" }),
    });

    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
        userLocation={{ lat: 37.7749, lng: -122.4194 }}
      />
    );

    fireEvent.change(screen.getByTestId("venue-name-input"), {
      target: { value: "Duplicate Place" },
    });

    fireEvent.click(screen.getByTestId("venue-submit-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("venue-submission-error")).toHaveTextContent(
        "Duplicate venue name"
      );
    });
  });

  it("applies custom className and custom data-testid", () => {
    render(
      <VenueSubmissionModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmitSuccess={mockOnSubmitSuccess}
        className="custom-modal-class"
        data-testid="custom-submission-modal"
      />
    );

    expect(screen.getByTestId("custom-submission-modal")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("custom-modal-class");
  });
});
