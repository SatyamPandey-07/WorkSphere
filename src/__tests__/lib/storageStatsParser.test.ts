import {
  parseOfflineStorageStats,
  parseStorageStats,
  hydrateOfflineStorageStats,
  hydrateStorageStats,
  saveOfflineStorageStats,
  DEFAULT_OFFLINE_STORAGE_STATS,
  STORAGE_STATS_CACHE_KEY,
  type OfflineStorageStats,
} from "@/lib/offline/storageStats";

describe("Offline Storage Stats Parser & Corrupted JSON Resilience (#4790)", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("parseOfflineStorageStats (corrupted JSON payload validation)", () => {
    it("gracefully catches SyntaxError on truncated or malformed JSON strings", () => {
      const corruptedStrings = [
        '{"usageBytes": 1024, "quotaBytes":', // truncated
        "{ malformed json string }",
        "undefined",
        "<xml>not json</xml>",
        "{",
        '{"usageBytes": NaN}',
      ];

      for (const corrupted of corruptedStrings) {
        const stats = parseOfflineStorageStats(corrupted);
        expect(stats).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("[StorageStats] Corrupted or malformed storage stats JSON detected"),
          expect.any(String),
        );
      }
    });

    it("returns default quota metrics for null, undefined, or empty string inputs", () => {
      expect(parseOfflineStorageStats(null)).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
      expect(parseOfflineStorageStats(undefined)).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
      expect(parseOfflineStorageStats("")).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
    });

    it("returns default quota metrics for non-object JSON values like primitives and arrays", () => {
      expect(parseOfflineStorageStats("12345")).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
      expect(parseOfflineStorageStats('"just a string"')).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
      expect(parseOfflineStorageStats("[1, 2, 3]")).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[StorageStats] Invalid storage stats payload format"),
      );
    });

    it("accurately parses valid storage stats JSON payload", () => {
      const validPayload: OfflineStorageStats = {
        usageBytes: 204800,
        quotaBytes: 1048576,
        usagePercent: 19.53,
        floorPlanBytes: 51200,
        floorPlanCount: 4,
        floorPlanPercentOfUsage: 25.0,
        floorPlanPercentOfQuota: 4.88,
        isEstimateAvailable: true,
      };

      const parsed = parseOfflineStorageStats(JSON.stringify(validPayload));
      expect(parsed).toEqual(validPayload);
    });

    it("recalculates percentages safely when partial valid JSON is provided", () => {
      const partialJson = JSON.stringify({
        usageBytes: 500,
        quotaBytes: 1000,
        floorPlanBytes: 250,
        floorPlanCount: 2,
        isEstimateAvailable: true,
      });

      const parsed = parseOfflineStorageStats(partialJson);
      expect(parsed.usagePercent).toBe(50);
      expect(parsed.floorPlanPercentOfUsage).toBe(50);
      expect(parsed.floorPlanPercentOfQuota).toBe(25);
      expect(parsed.floorPlanCount).toBe(2);
      expect(parsed.isEstimateAvailable).toBe(true);
    });

    it("aliases parseStorageStats to parseOfflineStorageStats", () => {
      expect(parseStorageStats).toBe(parseOfflineStorageStats);
    });
  });

  describe("hydrateOfflineStorageStats (localStorage hydration with error recovery)", () => {
    it("returns default metrics and catches SyntaxError when localStorage contains corrupted JSON", () => {
      localStorage.setItem(STORAGE_STATS_CACHE_KEY, '{"usageBytes": 1024, "quota');

      const stats = hydrateOfflineStorageStats();
      expect(stats).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it("hydrates successfully when valid stats are stored in localStorage", () => {
      const expected: OfflineStorageStats = {
        usageBytes: 4096,
        quotaBytes: 16384,
        usagePercent: 25,
        floorPlanBytes: 1024,
        floorPlanCount: 1,
        floorPlanPercentOfUsage: 25,
        floorPlanPercentOfQuota: 6.25,
        isEstimateAvailable: true,
      };

      saveOfflineStorageStats(expected);
      const hydrated = hydrateOfflineStorageStats();
      expect(hydrated).toEqual(expected);
    });

    it("returns default metrics when localStorage is empty", () => {
      const stats = hydrateOfflineStorageStats();
      expect(stats).toEqual(DEFAULT_OFFLINE_STORAGE_STATS);
    });

    it("aliases hydrateStorageStats to hydrateOfflineStorageStats", () => {
      expect(hydrateStorageStats).toBe(hydrateOfflineStorageStats);
    });
  });
});
