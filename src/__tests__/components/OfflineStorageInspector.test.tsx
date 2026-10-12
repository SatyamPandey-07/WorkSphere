import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  OfflineStorageInspector,
  formatSyncTimestamp,
  pruneStaleEntries,
  estimateStaleEntries,
  DEFAULT_MAX_CACHE_AGE_MS,
  SyncLogItem,
} from "../../components/OfflineStorageInspector";
import * as offlineDbModule from "@/lib/offline/db";

jest.mock("@/lib/offline/db", () => ({
  initOfflineDB: jest.fn(),
}));

describe("OfflineStorageInspector - formatSyncTimestamp", () => {
  it("formats valid epoch timestamps correctly", () => {
    const ts = 1700000000000;
    const expected = new Date(ts).toLocaleString();
    expect(formatSyncTimestamp(ts)).toBe(expected);
  });

  it("formats valid ISO date strings correctly", () => {
    const isoString = "2026-07-24T12:00:00.000Z";
    const expected = new Date(isoString).toLocaleString();
    expect(formatSyncTimestamp(isoString)).toBe(expected);
  });

  it("handles null, undefined, and empty string gracefully", () => {
    expect(formatSyncTimestamp(null)).toBe("N/A");
    expect(formatSyncTimestamp(undefined)).toBe("N/A");
    expect(formatSyncTimestamp("")).toBe("N/A");
    expect(formatSyncTimestamp(NaN)).toBe("N/A");
  });

  it("handles invalid timestamp values gracefully", () => {
    expect(formatSyncTimestamp("invalid-timestamp-str")).toBe("Invalid Date");
    expect(formatSyncTimestamp(new Date("invalid").getTime())).toBe("N/A");
  });
});

describe("OfflineStorageInspector Component", () => {
  const mockLogs: SyncLogItem[] = [
    {
      id: 1,
      type: "favorite",
      action: "ADD",
      venueId: "venue-101",
      timestamp: 1700000000000,
      retryCount: 0,
    },
    {
      id: 2,
      type: "crdt-sync",
      action: "UPDATE",
      venueId: "venue-202",
      timestamp: null,
      retryCount: 1,
    },
    {
      id: 3,
      type: "rate",
      action: "RATE",
      venueId: "venue-303",
      timestamp: "invalid-date",
      retryCount: 0,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <OfflineStorageInspector
        isOpen={false}
        onClose={jest.fn()}
        logs={mockLogs}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders modal and formats log timestamps when isOpen is true", () => {
    render(
      <OfflineStorageInspector
        isOpen={true}
        onClose={jest.fn()}
        logs={mockLogs}
      />,
    );

    expect(screen.getByText("Offline Storage Inspector")).toBeInTheDocument();
    expect(screen.getByText("venue-101")).toBeInTheDocument();

    const expectedDateStr = new Date(1700000000000).toLocaleString();
    expect(screen.getByText(expectedDateStr)).toBeInTheDocument();

    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(screen.getByText("Invalid Date")).toBeInTheDocument();
  });

  it("calls onClose when Close button or X icon is clicked", () => {
    const handleClose = jest.fn();
    render(
      <OfflineStorageInspector
        isOpen={true}
        onClose={handleClose}
        logs={mockLogs}
      />,
    );

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("triggers onClearLogs when Clear Log button is clicked", () => {
    const handleClear = jest.fn();
    render(
      <OfflineStorageInspector
        isOpen={true}
        onClose={jest.fn()}
        logs={mockLogs}
        onClearLogs={handleClear}
      />,
    );

    const clearBtn = screen.getByText("Clear Log");
    fireEvent.click(clearBtn);

    expect(handleClear).toHaveBeenCalledTimes(1);
  });
});

describe("Prune Stale Cache & Offline Store Transactions", () => {
  const now = Date.now();
  const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
  const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

  function createMockIndexedDB(storesData: Record<string, any[]>) {
    return {
      objectStoreNames: {
        contains: (name: string) => name in storesData,
      },
      transaction: (storeNames: string[], _mode: string) => {
        let activeStores = storeNames.length;
        const tx: any = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
          objectStore: (storeName: string) => {
            const originalItems = [...(storesData[storeName] || [])];
            return {
              openCursor: () => {
                let idx = 0;
                const req: any = {
                  result: null,
                  onsuccess: null,
                  onerror: null,
                };

                const advance = () => {
                  if (idx < originalItems.length) {
                    const currentItem = originalItems[idx];
                    req.result = {
                      value: currentItem,
                      delete: () => {
                        const deleteIdx =
                          storesData[storeName].indexOf(currentItem);
                        if (deleteIdx !== -1) {
                          storesData[storeName].splice(deleteIdx, 1);
                        }
                      },
                      continue: () => {
                        idx++;
                        setTimeout(advance, 0);
                      },
                    };
                  } else {
                    req.result = null;
                  }

                  if (req.onsuccess) {
                    req.onsuccess();
                  }

                  if (idx >= originalItems.length) {
                    activeStores--;
                    if (activeStores <= 0) {
                      setTimeout(() => {
                        if (tx.oncomplete) {
                          tx.oncomplete();
                        }
                      }, 0);
                    }
                  }
                };

                setTimeout(advance, 0);
                return req;
              },
            };
          },
        };
        return tx;
      },
    } as unknown as IDBDatabase;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prunes cache entries older than 7 days while preserving recent and protected entries", async () => {
    const venuesData = [
      { id: "v1", name: "Old Stale Venue", lastAccessedAt: eightDaysAgo },
      { id: "v2", name: "Recent Venue", lastAccessedAt: twoDaysAgo },
      {
        id: "v3",
        name: "Old Favorite",
        lastAccessedAt: eightDaysAgo,
        isFavorite: true,
      },
      {
        id: "v4",
        name: "Old Pinned",
        lastAccessedAt: eightDaysAgo,
        isPinned: true,
      },
    ];
    const searchesData = [
      { query: "coffee shops", timestamp: eightDaysAgo },
      { query: "quiet libraries", timestamp: twoDaysAgo },
    ];

    const mockDb = createMockIndexedDB({
      venues: venuesData,
      recentlyViewedVenues: [],
      searches: searchesData,
      notes_cache: [],
    });

    (offlineDbModule.initOfflineDB as jest.Mock).mockResolvedValue(mockDb);

    const result = await pruneStaleEntries(DEFAULT_MAX_CACHE_AGE_MS);

    // v1 from venues and "coffee shops" from searches should be deleted (2 items)
    expect(result.deletedCount).toBe(2);
    expect(result.recoveredBytes).toBeGreaterThan(0);
    expect(result.recoveredMB).toBeGreaterThanOrEqual(0);

    // Ensure v2, v3, and v4 remain in venuesData
    expect(venuesData.map((v) => v.id)).toEqual(["v2", "v3", "v4"]);
    // Ensure "quiet libraries" remains in searchesData
    expect(searchesData.map((s) => s.query)).toEqual(["quiet libraries"]);
  });

  it("estimates stale entries and reduction size accurately", async () => {
    const venuesData = [
      { id: "v1", name: "Old Stale Venue", savedAt: eightDaysAgo },
      { id: "v2", name: "Recent Venue", savedAt: twoDaysAgo },
    ];

    const mockDb = createMockIndexedDB({
      venues: venuesData,
      recentlyViewedVenues: [],
      searches: [],
      notes_cache: [],
    });

    (offlineDbModule.initOfflineDB as jest.Mock).mockResolvedValue(mockDb);

    const estimate = await estimateStaleEntries(DEFAULT_MAX_CACHE_AGE_MS);
    expect(estimate.count).toBe(1);
    expect(estimate.bytes).toBeGreaterThan(0);
  });

  it("renders Prune Stale Cache button with reduction estimate and quota badge", async () => {
    const venuesData = [
      { id: "v1", name: "Old Stale Venue", lastAccessedAt: eightDaysAgo },
    ];

    const mockDb = createMockIndexedDB({
      venues: venuesData,
      recentlyViewedVenues: [],
      searches: [],
      notes_cache: [],
    });

    (offlineDbModule.initOfflineDB as jest.Mock).mockResolvedValue(mockDb);

    // Mock navigator.storage.estimate
    Object.defineProperty(navigator, "storage", {
      value: {
        estimate: jest.fn().mockResolvedValue({
          usage: 12.5 * 1024 * 1024,
          quota: 500 * 1024 * 1024,
        }),
      },
      writable: true,
      configurable: true,
    });

    render(<OfflineStorageInspector isOpen={true} onClose={jest.fn()} />);

    // Check Quota Used badge
    await waitFor(() => {
      expect(screen.getByTestId("storage-consumption-badge")).toHaveTextContent(
        "12.5 MB / 500 MB",
      );
    });

    // Check Prune Stale Cache button
    const pruneBtn = screen.getByTestId("prune-stale-cache-btn");
    expect(pruneBtn).toBeInTheDocument();
    expect(pruneBtn).toHaveTextContent(/Prune Stale Cache/i);
  });

  it("triggers prune action and displays confirmation toast showing recovered megabytes", async () => {
    const venuesData = [
      {
        id: "v1",
        name: "Large Old Stale Venue Payload",
        lastAccessedAt: eightDaysAgo,
        data: "x".repeat(10000),
      },
      {
        id: "v2",
        name: "Another Old Payload",
        lastAccessedAt: eightDaysAgo,
        data: "y".repeat(10000),
      },
    ];

    const mockDb = createMockIndexedDB({
      venues: venuesData,
      recentlyViewedVenues: [],
      searches: [],
      notes_cache: [],
    });

    (offlineDbModule.initOfflineDB as jest.Mock).mockResolvedValue(mockDb);

    const onPruneMock = jest.fn();

    render(
      <OfflineStorageInspector
        isOpen={true}
        onClose={jest.fn()}
        onPrune={onPruneMock}
      />,
    );

    const pruneBtn = await screen.findByTestId("prune-stale-cache-btn");
    fireEvent.click(pruneBtn);

    // Confirmation toast should appear showing total megabytes recovered
    await waitFor(() => {
      const toast = screen.getByTestId("prune-confirmation-toast");
      expect(toast).toBeInTheDocument();
      expect(toast).toHaveTextContent(/Successfully pruned stale cache!/i);
      expect(toast).toHaveTextContent(/Recovered/i);
      expect(toast).toHaveTextContent(/MB/i);
    });

    expect(onPruneMock).toHaveBeenCalledTimes(1);

    // Dismiss confirmation toast
    const dismissBtn = screen.getByLabelText("Dismiss notification");
    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("prune-confirmation-toast")).toBeNull();
    });
  });

  describe("Storage Estimation Safeguards in Private Browsing / Restricted Mode", () => {
    it("safely handles when navigator.storage.estimate is not a function", async () => {
      Object.defineProperty(navigator, "storage", {
        value: { estimate: "not-a-function" },
        writable: true,
        configurable: true,
      });

      render(<OfflineStorageInspector isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("storage-unavailable-message"),
        ).toHaveTextContent(
          "Storage usage unavailable in private browsing mode",
        );
        expect(
          screen.getByTestId("storage-consumption-badge"),
        ).toHaveTextContent("0.0 MB");
      });
    });

    it("displays descriptive message when navigator.storage.estimate rejects with TypeError", async () => {
      Object.defineProperty(navigator, "storage", {
        value: {
          estimate: jest
            .fn()
            .mockRejectedValue(
              new TypeError("Storage estimation disabled in private browsing"),
            ),
        },
        writable: true,
        configurable: true,
      });

      render(<OfflineStorageInspector isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("storage-unavailable-message"),
        ).toHaveTextContent(
          "Storage usage unavailable in private browsing mode",
        );
        expect(
          screen.getByTestId("storage-consumption-badge"),
        ).toHaveTextContent("0.0 MB");
      });
    });

    it("gracefully handles when estimate() resolves to null without crashing", async () => {
      Object.defineProperty(navigator, "storage", {
        value: {
          estimate: jest.fn().mockResolvedValue(null),
        },
        writable: true,
        configurable: true,
      });

      render(<OfflineStorageInspector isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("storage-unavailable-message"),
        ).toHaveTextContent(
          "Storage usage unavailable in private browsing mode",
        );
        expect(
          screen.getByTestId("storage-consumption-badge"),
        ).toHaveTextContent("0.0 MB");
      });
    });

    it("provides fallback values when estimate.usage and estimate.quota are undefined", async () => {
      Object.defineProperty(navigator, "storage", {
        value: {
          estimate: jest.fn().mockResolvedValue({
            usage: undefined,
            quota: undefined,
          }),
        },
        writable: true,
        configurable: true,
      });

      render(<OfflineStorageInspector isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("storage-consumption-badge"),
        ).toHaveTextContent("0.0 MB");
        expect(
          screen.getByTestId("storage-unavailable-message"),
        ).toHaveTextContent(
          "Storage usage unavailable in private browsing mode",
        );
      });
    });

    it("provides fallback value when estimate.quota is undefined but usage is defined", async () => {
      Object.defineProperty(navigator, "storage", {
        value: {
          estimate: jest.fn().mockResolvedValue({
            usage: 5 * 1024 * 1024,
            quota: undefined,
          }),
        },
        writable: true,
        configurable: true,
      });

      render(<OfflineStorageInspector isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("storage-consumption-badge"),
        ).toHaveTextContent("5 MB");
      });
    });
  });
});
