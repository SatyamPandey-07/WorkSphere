import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  OfflineConflictResolutionModal,
  withConflictResolutionLock,
  CONFLICT_RESOLUTION_LOCK,
} from "@/components/offline/OfflineConflictResolutionModal";
import { useOfflineConflicts } from "@/hooks/useOfflineConflicts";
import { offlineConflictService } from "@/lib/offline/conflictService";

jest.mock("@/hooks/useOfflineConflicts");
jest.mock("@/lib/offline/conflictService");

const mockUseOfflineConflicts = useOfflineConflicts as jest.MockedFunction<
  typeof useOfflineConflicts
>;
const mockOfflineConflictService = offlineConflictService as jest.Mocked<
  typeof offlineConflictService
>;

describe("OfflineConflictResolutionModal Web Locks & Multi-Tab Synchronization (#5815)", () => {
  let mockRequestLock: jest.Mock;
  const mockResolveItem = jest.fn();
  const mockBulkResolve = jest.fn();
  const mockRefresh = jest.fn();

  const sampleConflicts = [
    {
      id: "conflict-rev-1",
      domain: "reviews",
      title: "Review for Cowork Central",
      timestamp: Date.now(),
      retryCount: 2,
      status: "CONFLICT" as const,
      clientPayload: { rating: 5, comment: "Amazing workspace" },
      serverState: { rating: 4, comment: "Decent workspace" },
      diffs: [],
      sourceStore: "queued-reviews" as const,
    },
    {
      id: "conflict-note-2",
      domain: "notes",
      title: "Note on Desk B-08",
      timestamp: Date.now(),
      retryCount: 1,
      status: "CONFLICT" as const,
      clientPayload: { text: "Reserved for afternoon" },
      serverState: { text: "Available all day" },
      diffs: [],
      sourceStore: "pending_sync_queue" as const,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequestLock = jest
      .fn()
      .mockImplementation((name, options, callback) => {
        return callback();
      });

    Object.defineProperty(navigator, "locks", {
      value: {
        request: mockRequestLock,
      },
      writable: true,
      configurable: true,
    });

    mockUseOfflineConflicts.mockReturnValue({
      conflicts: sampleConflicts,
      conflictCount: 2,
      isLoading: false,
      resolveItem: mockResolveItem.mockResolvedValue(true),
      bulkResolve: mockBulkResolve.mockResolvedValue(undefined),
      refresh: mockRefresh.mockResolvedValue(undefined),
    });

    mockOfflineConflictService.getConflictedItems.mockResolvedValue(
      sampleConflicts,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("withConflictResolutionLock helper", () => {
    it("wraps execution in an exclusive Web Lock worksphere_conflict_resolution", async () => {
      const action = jest.fn().mockResolvedValue("action-result");

      const result = await withConflictResolutionLock(action);

      expect(mockRequestLock).toHaveBeenCalledWith(
        CONFLICT_RESOLUTION_LOCK,
        { mode: "exclusive" },
        expect.any(Function),
      );
      expect(action).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        result: "action-result",
        alreadyResolved: false,
      });
    });

    it("detects if conflict has already been resolved by another tab and skips action", async () => {
      const action = jest.fn().mockResolvedValue("action-result");
      const checkAlreadyResolved = jest.fn().mockResolvedValue(true);

      const result = await withConflictResolutionLock(action, {
        checkAlreadyResolved,
      });

      expect(checkAlreadyResolved).toHaveBeenCalled();
      expect(action).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        alreadyResolved: true,
      });
    });

    it("handles browsers without Web Locks API via safe transaction retry backoff", async () => {
      // Simulate environment without Web Locks API
      Object.defineProperty(navigator, "locks", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const abortError = new Error("The transaction was aborted");
      abortError.name = "AbortError";

      let attempts = 0;
      const action = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          throw abortError;
        }
        return Promise.resolve("recovered-result");
      });

      const result = await withConflictResolutionLock(action, {
        maxRetries: 3,
      });

      expect(action).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        success: true,
        result: "recovered-result",
        alreadyResolved: false,
      });
    });
  });

  describe("OfflineConflictResolutionModal component multi-tab synchronization", () => {
    it("renders modal with Web Lock status badge and conflict items", () => {
      render(
        <OfflineConflictResolutionModal isOpen={true} onClose={jest.fn()} />,
      );

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("web-lock-indicator")).toHaveTextContent(
        "Web Lock Active",
      );
      expect(screen.getByText("Review for Cowork Central")).toBeInTheDocument();
      expect(screen.getByText("Note on Desk B-08")).toBeInTheDocument();
    });

    it("resolves conflict within exclusive Web Lock when user chooses client wins", async () => {
      render(
        <OfflineConflictResolutionModal isOpen={true} onClose={jest.fn()} />,
      );

      const keepLocalBtn = screen.getByTestId("keep-local-btn-conflict-rev-1");
      expect(keepLocalBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(keepLocalBtn);
      });

      // Verifies exclusive lock was requested
      expect(mockRequestLock).toHaveBeenCalledWith(
        CONFLICT_RESOLUTION_LOCK,
        { mode: "exclusive" },
        expect.any(Function),
      );
      expect(mockResolveItem).toHaveBeenCalledWith(
        sampleConflicts[0],
        "CLIENT_WINS",
      );
    });

    it("detects when conflict was already resolved in another tab and shows notice banner", async () => {
      // Simulate item no longer present in IndexedDB (already resolved elsewhere)
      mockOfflineConflictService.getConflictedItems.mockResolvedValue([
        sampleConflicts[1],
      ]);

      render(
        <OfflineConflictResolutionModal isOpen={true} onClose={jest.fn()} />,
      );

      const acceptServerBtn = screen.getByTestId(
        "accept-server-btn-conflict-rev-1",
      );

      await act(async () => {
        fireEvent.click(acceptServerBtn);
      });

      // Action skipped and notice displayed
      expect(mockResolveItem).not.toHaveBeenCalled();
      const notice = screen.getByTestId("conflict-resolution-notice");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveTextContent(/already resolved in another tab/i);
      expect(mockRefresh).toHaveBeenCalled();
    });

    it("performs bulk resolution under exclusive Web Lock", async () => {
      render(
        <OfflineConflictResolutionModal isOpen={true} onClose={jest.fn()} />,
      );

      const bulkLocalBtn = screen.getByTestId("bulk-client-wins-btn");
      expect(bulkLocalBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(bulkLocalBtn);
      });

      expect(mockRequestLock).toHaveBeenCalledWith(
        CONFLICT_RESOLUTION_LOCK,
        { mode: "exclusive" },
        expect.any(Function),
      );
      expect(mockBulkResolve).toHaveBeenCalledWith("CLIENT_WINS");
    });
  });
});
