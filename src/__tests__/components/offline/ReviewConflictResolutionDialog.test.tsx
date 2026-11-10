import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ReviewConflictResolutionDialog,
  ReviewConflictResolutionDialogProps,
} from "@/components/offline/ReviewConflictResolutionDialog";
import type { QueuedReviewItem } from "@/workers/reviewConflictSync.worker";

describe("ReviewConflictResolutionDialog Component (#6895)", () => {
  const mockOnClose = jest.fn();
  const mockOnResolve = jest.fn();

  const sampleConflictItem: NonNullable<ReviewConflictResolutionDialogProps["conflictItem"]> = {
    id: "review-conflict-42",
    venueId: "venue-workspace-99",
    venueName: "Nexus Coworking Cafe",
    conflictDetails: {
      conflictType: "CONCURRENT_MODIFICATION",
      message: "Server updated while offline",
      serverReview: {
        wifiQuality: 3,
        noiseLevel: "quiet",
        hasOutlets: true,
        downloadSpeed: 85,
        comment: "Great tea, reliable internet on 2nd floor.",
      },
    },
    localReview: {
      id: "review-conflict-42",
      venueId: "venue-workspace-99",
      venueName: "Nexus Coworking Cafe",
      createdAt: 1729000000000,
      retryCount: 1,
      status: "CONFLICT",
      data: {
        wifiQuality: 5,
        noiseLevel: "loud",
        hasOutlets: false,
        downloadSpeed: 120,
        comment: "Very loud afternoon, power outlets all taken.",
      },
    } as QueuedReviewItem,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnResolve.mockResolvedValue(undefined);
  });

  describe("Visibility & Rendering", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <ReviewConflictResolutionDialog
          isOpen={false}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when conflictItem is null", () => {
      const { container } = render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={null}
          onResolve={mockOnResolve}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders dialog header, venue title, and diff fields when open", () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      expect(screen.getByTestId("review-conflict-dialog")).toBeInTheDocument();
      expect(screen.getByText("Three-Way Review Merge Conflict")).toBeInTheDocument();
      expect(screen.getByText(/Nexus Coworking Cafe/i)).toBeInTheDocument();
      expect(screen.getByText(/conflicting fields detected/i)).toBeInTheDocument();

      // Diff rows
      expect(screen.getByTestId("diff-row-wifiQuality")).toBeInTheDocument();
      expect(screen.getByTestId("diff-row-noiseLevel")).toBeInTheDocument();
      expect(screen.getByTestId("diff-row-hasOutlets")).toBeInTheDocument();
      expect(screen.getByTestId("diff-row-downloadSpeed")).toBeInTheDocument();
      expect(screen.getByTestId("diff-row-comment")).toBeInTheDocument();
    });
  });

  describe("Resolution Modes & Submission", () => {
    it("submits THREE_WAY_MERGE by default on apply", async () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      const applyBtn = screen.getByTestId("apply-resolution-btn");
      await act(async () => {
        fireEvent.click(applyBtn);
      });

      expect(mockOnResolve).toHaveBeenCalledWith("review-conflict-42", "THREE_WAY_MERGE");
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("submits KEEP_LOCAL when Keep Local Draft mode is selected", async () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      const keepLocalBtn = screen.getByTestId("mode-keep-local");
      fireEvent.click(keepLocalBtn);

      const applyBtn = screen.getByTestId("apply-resolution-btn");
      await act(async () => {
        fireEvent.click(applyBtn);
      });

      expect(mockOnResolve).toHaveBeenCalledWith("review-conflict-42", "KEEP_LOCAL");
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("submits USE_REMOTE when Accept Server Version mode is selected", async () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      const useRemoteBtn = screen.getByTestId("mode-use-remote");
      fireEvent.click(useRemoteBtn);

      const applyBtn = screen.getByTestId("apply-resolution-btn");
      await act(async () => {
        fireEvent.click(applyBtn);
      });

      expect(mockOnResolve).toHaveBeenCalledWith("review-conflict-42", "USE_REMOTE");
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("allows field-by-field pick and custom comment in CUSTOM mode", async () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      const customModeBtn = screen.getByTestId("mode-custom");
      fireEvent.click(customModeBtn);

      expect(screen.getByTestId("custom-comment-section")).toBeInTheDocument();

      // Select server wifi (3)
      const serverWifi = screen.getByTestId("field-wifiQuality-remote");
      fireEvent.click(serverWifi);

      // Select server noiseLevel (quiet)
      const serverNoise = screen.getByTestId("field-noiseLevel-remote");
      fireEvent.click(serverNoise);

      // Edit custom comment
      const commentInput = screen.getByTestId("custom-comment-textarea");
      fireEvent.change(commentInput, { target: { value: "Reconciled custom comment" } });

      const applyBtn = screen.getByTestId("apply-resolution-btn");
      await act(async () => {
        fireEvent.click(applyBtn);
      });

      expect(mockOnResolve).toHaveBeenCalledWith(
        "review-conflict-42",
        "CUSTOM_MERGE",
        expect.objectContaining({
          wifiQuality: 3,
          noiseLevel: "quiet",
          hasOutlets: false, // kept local
          downloadSpeed: 120, // kept local
          comment: "Reconciled custom comment",
        }),
      );
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("sanitizes invalid/non-numeric serverData values in CUSTOM mode", async () => {
      const itemWithMalformedServerData = {
        ...sampleConflictItem,
        conflictDetails: {
          ...sampleConflictItem.conflictDetails,
          serverReview: {
            wifiQuality: "invalid-rating",
            downloadSpeed: "unknown-speed",
          },
        },
      };

      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={itemWithMalformedServerData}
          onResolve={mockOnResolve}
        />,
      );

      fireEvent.click(screen.getByTestId("mode-custom"));
      fireEvent.click(screen.getByTestId("field-wifiQuality-remote"));
      fireEvent.click(screen.getByTestId("field-downloadSpeed-remote"));

      await act(async () => {
        fireEvent.click(screen.getByTestId("apply-resolution-btn"));
      });

      expect(mockOnResolve).toHaveBeenCalledWith(
        "review-conflict-42",
        "CUSTOM_MERGE",
        expect.objectContaining({
          wifiQuality: 5, // fallback to local since parsed server rating was NaN
          downloadSpeed: 120, // fallback to local since parsed server speed was NaN
        }),
      );
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("does not close modal if onResolve throws an error", async () => {
      mockOnResolve.mockRejectedValueOnce(new Error("Network sync failure"));

      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("apply-resolution-btn"));
      });

      expect(mockOnResolve).toHaveBeenCalledTimes(1);
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe("Keyboard Navigation & Dismissal", () => {
    it("dismisses dialog when Escape key is pressed", () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss on Escape if isResolving is true", () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
          isResolving={true}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it("allows keyboard selection using Enter and Space in CUSTOM mode", () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      fireEvent.click(screen.getByTestId("mode-custom"));

      const serverWifi = screen.getByTestId("field-wifiQuality-remote");
      fireEvent.keyDown(serverWifi, { key: "Enter" });
      expect(serverWifi).toHaveAttribute("aria-pressed", "true");

      const localWifi = screen.getByTestId("field-wifiQuality-local");
      fireEvent.keyDown(localWifi, { key: " " });
      expect(localWifi).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("Backdrop Dismissal & Interactive Elements", () => {
    it("dismisses on backdrop click when closeOnBackdropClick is true", () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
          closeOnBackdropClick={true}
        />,
      );

      const backdrop = screen.getByTestId("review-conflict-dialog");
      fireEvent.click(backdrop);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss on backdrop click when closeOnBackdropClick is false", () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
          closeOnBackdropClick={false}
        />,
      );

      const backdrop = screen.getByTestId("review-conflict-dialog");
      fireEvent.click(backdrop);

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it("calls onClose when Close or Cancel buttons are clicked", () => {
      const { rerender } = render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      fireEvent.click(screen.getByTestId("close-conflict-dialog-btn"));
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      rerender(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
        />,
      );

      fireEvent.click(screen.getByTestId("cancel-conflict-dialog-btn"));
      expect(mockOnClose).toHaveBeenCalledTimes(2);
    });

    it("disables buttons and displays spinner when isResolving is true", () => {
      render(
        <ReviewConflictResolutionDialog
          isOpen={true}
          onClose={mockOnClose}
          conflictItem={sampleConflictItem}
          onResolve={mockOnResolve}
          isResolving={true}
        />,
      );

      expect(screen.getByTestId("close-conflict-dialog-btn")).toBeDisabled();
      expect(screen.getByTestId("cancel-conflict-dialog-btn")).toBeDisabled();
      expect(screen.getByTestId("apply-resolution-btn")).toBeDisabled();
      expect(screen.getByTestId("resolving-spinner")).toBeInTheDocument();
    });
  });
});
