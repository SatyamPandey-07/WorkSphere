import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OfflineConflictBadge } from "@/components/offline/OfflineConflictBadge";
import { useOfflineConflicts } from "@/hooks/useOfflineConflicts";

jest.mock("@/hooks/useOfflineConflicts");
jest.mock("@/components/offline/OfflineConflictResolutionModal", () => ({
  OfflineConflictResolutionModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="mock-resolution-modal">
        <span>Resolution Modal Content</span>
        <button data-testid="mock-close-modal-btn" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

const mockUseOfflineConflicts = useOfflineConflicts as jest.MockedFunction<
  typeof useOfflineConflicts
>;

describe("OfflineConflictBadge Component (#6897)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Sanitization & Guarding", () => {
    it("renders nothing when conflictCount is 0", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 0,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      const { container } = render(<OfflineConflictBadge />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when conflictCount is negative", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: -3,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      const { container } = render(<OfflineConflictBadge />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when conflictCount is NaN", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: NaN as any,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      const { container } = render(<OfflineConflictBadge />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when conflictCount is undefined or null", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: undefined as any,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      const { container } = render(<OfflineConflictBadge />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Count Formatting & Accessibility", () => {
    it("renders singular '1 Conflict' text and correct aria-label when conflictCount is 1", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 1,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      render(<OfflineConflictBadge />);

      const badge = screen.getByTestId("offline-conflict-badge");
      expect(badge).toBeInTheDocument();
      expect(screen.getByTestId("offline-conflict-badge-text")).toHaveTextContent("1 Conflict");
      expect(badge).toHaveAttribute(
        "aria-label",
        "1 offline conflict detected in IndexedDB. Click to resolve.",
      );
      expect(badge).toHaveAttribute(
        "title",
        "1 offline conflict detected in IndexedDB. Click to resolve.",
      );
      expect(screen.getByTestId("offline-conflict-badge-icon")).toBeInTheDocument();
    });

    it("renders plural '5 Conflicts' text and correct aria-label when conflictCount is > 1", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 5,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      render(<OfflineConflictBadge />);

      const badge = screen.getByTestId("offline-conflict-badge");
      expect(badge).toBeInTheDocument();
      expect(screen.getByTestId("offline-conflict-badge-text")).toHaveTextContent("5 Conflicts");
      expect(badge).toHaveAttribute(
        "aria-label",
        "5 offline conflicts detected in IndexedDB. Click to resolve.",
      );
    });

    it("floors floating-point conflict count values", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 3.8,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      render(<OfflineConflictBadge />);

      expect(screen.getByTestId("offline-conflict-badge-text")).toHaveTextContent("3 Conflicts");
    });
  });

  describe("Styling & Props Customization", () => {
    it("includes animate-pulse class by default", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 2,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      render(<OfflineConflictBadge />);

      const badge = screen.getByTestId("offline-conflict-badge");
      expect(badge).toHaveClass("animate-pulse");
    });

    it("omits animate-pulse when showPulse is false", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 2,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      render(<OfflineConflictBadge showPulse={false} />);

      const badge = screen.getByTestId("offline-conflict-badge");
      expect(badge).not.toHaveClass("animate-pulse");
    });

    it("applies custom className", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 2,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      render(<OfflineConflictBadge className="custom-test-class" />);

      const badge = screen.getByTestId("offline-conflict-badge");
      expect(badge).toHaveClass("custom-test-class");
    });

    it("supports custom data-testid prop", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 2,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      render(<OfflineConflictBadge data-testid="header-offline-badge" />);

      expect(screen.getByTestId("header-offline-badge")).toBeInTheDocument();
    });
  });

  describe("Modal Integration & Interactions", () => {
    it("opens modal and triggers onClick callback when clicked", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 2,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      const mockOnClick = jest.fn();
      render(<OfflineConflictBadge onClick={mockOnClick} />);

      expect(screen.queryByTestId("mock-resolution-modal")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("offline-conflict-badge"));

      expect(mockOnClick).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("mock-resolution-modal")).toBeInTheDocument();
    });

    it("closes modal when modal onClose callback is triggered", () => {
      mockUseOfflineConflicts.mockReturnValue({
        conflictCount: 2,
        conflicts: [],
        isLoading: false,
        resolveItem: jest.fn(),
        bulkResolve: jest.fn(),
        refresh: jest.fn(),
      });

      render(<OfflineConflictBadge />);

      // Open
      fireEvent.click(screen.getByTestId("offline-conflict-badge"));
      expect(screen.getByTestId("mock-resolution-modal")).toBeInTheDocument();

      // Close
      fireEvent.click(screen.getByTestId("mock-close-modal-btn"));
      expect(screen.queryByTestId("mock-resolution-modal")).not.toBeInTheDocument();
    });
  });
});
