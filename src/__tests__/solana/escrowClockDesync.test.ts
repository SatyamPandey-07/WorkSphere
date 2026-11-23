import { Connection } from "@solana/web3.js";
import {
  getClusterBlockTime,
  validateEscrowCommitmentExpiration,
  MAX_RPC_CLOCK_SKEW_SECONDS,
} from "@/lib/solana/solanaPayEscrow";
import { isEscrowExpired } from "@/lib/solana/escrowClient";

describe("Solana RPC Clock Desynchronization Handling (#9735)", () => {
  let mockPrimaryConnection: jest.Mocked<Connection>;
  let mockBackupConnection: jest.Mocked<Connection>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrimaryConnection = {
      getBlockTime: jest.fn(),
    } as unknown as jest.Mocked<Connection>;

    mockBackupConnection = {
      getBlockTime: jest.fn(),
    } as unknown as jest.Mocked<Connection>;
  });

  describe("getClusterBlockTime", () => {
    it("returns cluster block-time from primary connection", async () => {
      const anchorSlot = 123456;
      const expectedBlockTime = 1700000000;
      mockPrimaryConnection.getBlockTime.mockResolvedValue(expectedBlockTime);

      const result = await getClusterBlockTime(mockPrimaryConnection, anchorSlot);
      expect(result).toBe(expectedBlockTime);
      expect(mockPrimaryConnection.getBlockTime).toHaveBeenCalledWith(anchorSlot);
    });

    it("falls back to backup connection when primary fails", async () => {
      const anchorSlot = 123456;
      const expectedBlockTime = 1700000050;
      mockPrimaryConnection.getBlockTime.mockRejectedValue(new Error("RPC 503 Service Unavailable"));
      mockBackupConnection.getBlockTime.mockResolvedValue(expectedBlockTime);

      const result = await getClusterBlockTime(
        mockPrimaryConnection,
        anchorSlot,
        [mockBackupConnection],
      );

      expect(result).toBe(expectedBlockTime);
      expect(mockPrimaryConnection.getBlockTime).toHaveBeenCalledWith(anchorSlot);
      expect(mockBackupConnection.getBlockTime).toHaveBeenCalledWith(anchorSlot);
    });

    it("returns null safely when all RPC endpoints return null or throw", async () => {
      const anchorSlot = 123456;
      mockPrimaryConnection.getBlockTime.mockResolvedValue(null);
      mockBackupConnection.getBlockTime.mockRejectedValue(new Error("Connection timeout"));

      const result = await getClusterBlockTime(
        mockPrimaryConnection,
        anchorSlot,
        [mockBackupConnection],
      );

      expect(result).toBeNull();
    });

    it("detects inconsistent RPC responses beyond 5 minutes skew and fails safely", async () => {
      const anchorSlot = 123456;
      // Primary reports time T, but backup reports T + 350 seconds (skew > 300s)
      mockPrimaryConnection.getBlockTime.mockResolvedValue(1700000000);
      mockBackupConnection.getBlockTime.mockResolvedValue(1700000350);

      const result = await getClusterBlockTime(
        mockPrimaryConnection,
        anchorSlot,
        [mockBackupConnection],
      );

      // Inconsistent clock beyond 300s skew threshold returns null
      expect(result).toBeNull();
    });

    it("accepts consistent RPC responses within 5 minutes skew", async () => {
      const anchorSlot = 123456;
      // Primary reports 1700000000, backup reports 1700000060 (within 300s)
      mockPrimaryConnection.getBlockTime.mockResolvedValue(1700000000);
      mockBackupConnection.getBlockTime.mockResolvedValue(1700000060);

      const result = await getClusterBlockTime(
        mockPrimaryConnection,
        anchorSlot,
        [mockBackupConnection],
      );

      expect(result).toBe(1700000000);
    });
  });

  describe("validateEscrowCommitmentExpiration", () => {
    const anchorSlot = 250000;
    const baseTimeSec = 1700000000;
    // Escrow hold set to expire at baseTimeSec + 600 seconds
    const expiresAtSec = baseTimeSec + 600;
    const expiresAtDate = new Date(expiresAtSec * 1000);

    it("normal cluster time: accepts a valid escrow commitment prior to expiry", async () => {
      mockPrimaryConnection.getBlockTime.mockResolvedValue(baseTimeSec);

      const validation = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: anchorSlot,
        expiresAt: expiresAtDate,
      });

      expect(validation.expired).toBe(false);
      expect(validation.blockTimeSec).toBe(baseTimeSec);
      expect(validation.clockSource).toBe("cluster_block_time");
    });

    it("RPC clock ahead by 120s: valid deposit/commitment is NOT prematurely expired", async () => {
      // Cluster/RPC time is ahead by 120s (baseTimeSec + 650s vs threshold 600s)
      // Since 650s <= 600s + 300s (threshold + 5 min skew tolerance), it is NOT expired yet
      const aheadBlockTime = baseTimeSec + 650;
      mockPrimaryConnection.getBlockTime.mockResolvedValue(aheadBlockTime);

      const validation = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: anchorSlot,
        expiresAt: expiresAtDate,
      });

      expect(validation.expired).toBe(false);
      expect(validation.blockTimeSec).toBe(aheadBlockTime);
    });

    it("RPC clock behind by 120s: timeout calculations remain safe", async () => {
      // Cluster/RPC time is behind (baseTimeSec + 500s)
      const behindBlockTime = baseTimeSec + 500;
      mockPrimaryConnection.getBlockTime.mockResolvedValue(behindBlockTime);

      const validation = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: anchorSlot,
        expiresAt: expiresAtDate,
      });

      expect(validation.expired).toBe(false);
      expect(validation.blockTimeSec).toBe(behindBlockTime);
    });

    it("tolerates up to 300 seconds skew without prematurely expiring commitment", async () => {
      // Exactly at the 300s skew boundary: expiresAtSec + 300s
      const boundaryTime = expiresAtSec + MAX_RPC_CLOCK_SKEW_SECONDS;
      mockPrimaryConnection.getBlockTime.mockResolvedValue(boundaryTime);

      const validation = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: anchorSlot,
        expiresAt: expiresAtDate,
      });

      // At boundary, blockTime <= expiresAt + skewTolerance -> not expired
      expect(validation.expired).toBe(false);
    });

    it("beyond 5 minutes skew: genuinely expired escrow is recognized as expired", async () => {
      // Beyond 300s boundary: expiresAtSec + 301s
      const expiredTime = expiresAtSec + MAX_RPC_CLOCK_SKEW_SECONDS + 1;
      mockPrimaryConnection.getBlockTime.mockResolvedValue(expiredTime);

      const validation = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: anchorSlot,
        expiresAt: expiresAtDate,
      });

      expect(validation.expired).toBe(true);
      expect(validation.blockTimeSec).toBe(expiredTime);
    });

    it("missing block-time: fails safely without triggering premature refund", async () => {
      mockPrimaryConnection.getBlockTime.mockResolvedValue(null);

      const validation = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: anchorSlot,
        expiresAt: expiresAtDate,
      });

      expect(validation.expired).toBe(false);
      expect(validation.blockTimeSec).toBeNull();
      expect(validation.clockSource).toBe("unavailable");
      expect(validation.reason).toContain("Cluster block-time unavailable");
    });

    it("missing anchor slot: fails safely without throwing", async () => {
      const validation = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: null,
        expiresAt: expiresAtDate,
      });

      expect(validation.expired).toBe(false);
      expect(validation.blockTimeSec).toBeNull();
      expect(validation.clockSource).toBe("unavailable");
    });

    it("handles seconds vs milliseconds timestamp formats consistently", async () => {
      const blockTimeSec = baseTimeSec;
      mockPrimaryConnection.getBlockTime.mockResolvedValue(blockTimeSec);

      // Pass milliseconds as number
      const validationMs = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: anchorSlot,
        expiresAt: expiresAtSec * 1000,
      });
      expect(validationMs.expiresAtSec).toBe(expiresAtSec);

      // Pass seconds as number
      const validationSec = await validateEscrowCommitmentExpiration({
        connection: mockPrimaryConnection,
        slot: anchorSlot,
        expiresAt: expiresAtSec,
      });
      expect(validationSec.expiresAtSec).toBe(expiresAtSec);
    });
  });

  describe("isEscrowExpired with cluster block-time", () => {
    const bookingDate = new Date("2026-11-20T10:00:00Z");
    const graceHours = 24;
    // Expiry: 2026-11-21T10:00:00Z -> 1795255200 sec
    const expirySec = Math.floor(
      (bookingDate.getTime() + graceHours * 3600 * 1000) / 1000,
    );

    it("evaluates expired state using cluster block-time instead of wall clock", () => {
      // Cluster time is before expiry + skew
      const clusterTimeActive = expirySec + 100; // within 300s skew
      expect(isEscrowExpired(bookingDate, graceHours, clusterTimeActive)).toBe(false);

      // Cluster time is beyond expiry + 300s skew
      const clusterTimeExpired = expirySec + 301;
      expect(isEscrowExpired(bookingDate, graceHours, clusterTimeExpired)).toBe(true);
    });

    it("falls back to local wall clock only when cluster block-time is not provided", () => {
      const pastBooking = new Date(Date.now() - 48 * 3600 * 1000);
      expect(isEscrowExpired(pastBooking, graceHours)).toBe(true);

      const futureBooking = new Date(Date.now() + 48 * 3600 * 1000);
      expect(isEscrowExpired(futureBooking, graceHours)).toBe(false);
    });
  });
});
