import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  NomadCertificateModal,
  isEligibleForAttendanceCertificate,
  AttendanceBookingData,
} from "@/components/profile/NomadCertificateModal";

describe("NomadCertificateModal", () => {
  const eligibleBooking: AttendanceBookingData = {
    id: "booking_123",
    confirmationId: "CONF-9988",
    date: "2026-11-20",
    time: "10:00",
    duration: 180,
    status: "COMPLETED",
    seatNumber: "Desk-5",
    venue: {
      id: "venue_1",
      name: "Coworking Space Central",
      address: "123 Main St, New York, NY",
      category: "Coworking Space",
    },
  };

  const cancelledBooking: AttendanceBookingData = {
    ...eligibleBooking,
    status: "CANCELLED",
  };

  const incompleteVenueBooking: AttendanceBookingData = {
    ...eligibleBooking,
    venue: {
      name: "",
      address: "",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    window.URL.createObjectURL = jest.fn(() => "blob:http://localhost/cert-blob");
    window.URL.revokeObjectURL = jest.fn();
  });

  describe("Eligibility Logic", () => {
    it("returns true for completed booking with valid venue details", () => {
      expect(isEligibleForAttendanceCertificate(eligibleBooking)).toBe(true);
    });

    it("returns false for cancelled or pending bookings", () => {
      expect(isEligibleForAttendanceCertificate(cancelledBooking)).toBe(false);
      expect(
        isEligibleForAttendanceCertificate({
          ...eligibleBooking,
          status: "PENDING",
        }),
      ).toBe(false);
    });

    it("returns false when venue information is missing or incomplete", () => {
      expect(isEligibleForAttendanceCertificate(incompleteVenueBooking)).toBe(false);
      expect(
        isEligibleForAttendanceCertificate({ ...eligibleBooking, venue: null }),
      ).toBe(false);
    });

    it("returns false for invalid date or time", () => {
      expect(
        isEligibleForAttendanceCertificate({
          ...eligibleBooking,
          date: "not-a-date",
        }),
      ).toBe(false);
    });
  });

  describe("Modal Rendering & User Actions", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <NomadCertificateModal
          isOpen={false}
          onClose={jest.fn()}
          booking={eligibleBooking}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("renders modal with stay details and download button when open with eligible booking", () => {
      render(
        <NomadCertificateModal
          isOpen={true}
          onClose={jest.fn()}
          booking={eligibleBooking}
        />,
      );

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Nomad Attendance Certificate")).toBeInTheDocument();
      expect(screen.getByText("Coworking Space Central")).toBeInTheDocument();
      expect(screen.getByText(/123 Main St, New York, NY/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Download Attendance Certificate/i }),
      ).toBeInTheDocument();
    });

    it("shows unavailable alert and hides download button for cancelled reservations", () => {
      render(
        <NomadCertificateModal
          isOpen={true}
          onClose={jest.fn()}
          booking={cancelledBooking}
        />,
      );

      expect(screen.getByText("Certificate Not Available")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Download Attendance Certificate/i }),
      ).not.toBeInTheDocument();
    });

    it("handles download workflow, sets loading state, and downloads file", async () => {
      const mockBlob = new Blob(["mock-pdf-bytes"], { type: "application/pdf" });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        blob: async () => mockBlob,
      });

      const onDownloadSuccess = jest.fn();

      render(
        <NomadCertificateModal
          isOpen={true}
          onClose={jest.fn()}
          booking={eligibleBooking}
          onDownloadSuccess={onDownloadSuccess}
        />,
      );

      const downloadButton = screen.getByRole("button", {
        name: /Download Attendance Certificate/i,
      });
      fireEvent.click(downloadButton);

      // In flight state
      expect(downloadButton).toBeDisabled();
      expect(screen.getByText("Generating Certificate…")).toBeInTheDocument();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/bookings/booking_123/certificate",
        );
      });

      await waitFor(() => {
        expect(onDownloadSuccess).toHaveBeenCalledWith(
          "worksphere-attendance-certificate-CONF-9988.pdf",
        );
        expect(
          screen.getByText("Certificate downloaded successfully!"),
        ).toBeInTheDocument();
      });
    });

    it("handles download errors gracefully and shows error message", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Database failure occurred" }),
      });

      const onDownloadError = jest.fn();

      render(
        <NomadCertificateModal
          isOpen={true}
          onClose={jest.fn()}
          booking={eligibleBooking}
          onDownloadError={onDownloadError}
        />,
      );

      const downloadButton = screen.getByRole("button", {
        name: /Download Attendance Certificate/i,
      });
      fireEvent.click(downloadButton);

      await waitFor(() => {
        expect(
          screen.getByText("Database failure occurred"),
        ).toBeInTheDocument();
        expect(onDownloadError).toHaveBeenCalled();
      });

      // Button should be re-enabled
      expect(downloadButton).not.toBeDisabled();
    });

    it("prevents duplicate concurrent clicks while download is in progress", async () => {
      let resolveFetch: (val: any) => void = () => {};
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      (global.fetch as jest.Mock).mockReturnValue(fetchPromise);

      render(
        <NomadCertificateModal
          isOpen={true}
          onClose={jest.fn()}
          booking={eligibleBooking}
        />,
      );

      const downloadButton = screen.getByRole("button", {
        name: /Download Attendance Certificate/i,
      });
      fireEvent.click(downloadButton);
      fireEvent.click(downloadButton); // Concurrent click

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Finish fetch
      resolveFetch({
        ok: true,
        blob: async () => new Blob(["test"], { type: "application/pdf" }),
      });

      await waitFor(() => {
        expect(
          screen.getByText("Certificate downloaded successfully!"),
        ).toBeInTheDocument();
      });
    });

    it("closes when close button is clicked or Escape key is pressed", () => {
      const onClose = jest.fn();
      render(
        <NomadCertificateModal
          isOpen={true}
          onClose={onClose}
          booking={eligibleBooking}
        />,
      );

      fireEvent.click(screen.getByLabelText("Close modal"));
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
