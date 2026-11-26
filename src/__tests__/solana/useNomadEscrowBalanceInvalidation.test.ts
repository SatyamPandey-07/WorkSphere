import { renderHook, act } from "@testing-library/react";
import { useNomadEscrow } from "@/hooks/useNomadEscrow";
import { Connection } from "@solana/web3.js";

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: jest.fn(),
  };
});

jest.mock("@/lib/solana/escrowClient", () => ({
  simulateEscrowTransaction: jest.fn().mockResolvedValue({ success: true }),
  reconcilePendingSignature: jest.fn().mockResolvedValue(true),
}));

describe("useNomadEscrow - Wallet Balance Cache Invalidation (#10453)", () => {
  const WALLET_A = "11111111111111111111111111111111";
  const WALLET_B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  let mockGetBalance: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBalance = jest.fn();
    (Connection as unknown as jest.Mock).mockImplementation(() => ({
      getBalance: mockGetBalance,
    }));
  });

  describe("1. Wallet Disconnect and Reconnect Invalidation", () => {
    it("invalidates cached balance when wallet disconnects (publicKey becomes null)", async () => {
      mockGetBalance.mockResolvedValue(2_000_000_000); // 2 SOL

      let walletKey: string | null = WALLET_A;
      const { result, rerender } = renderHook(() =>
        useNomadEscrow({ walletPublicKey: walletKey })
      );

      // Wait for initial fetch
      await act(async () => {
        await result.current.fetchBalance();
      });

      expect(result.current.balance).toBe(2);
      expect(result.current.balanceLamports).toBe(2_000_000_000);

      // Disconnect wallet
      walletKey = null;
      await act(async () => {
        rerender();
      });

      // State is immediately cleared upon disconnect
      expect(result.current.balance).toBeNull();
      expect(result.current.balanceLamports).toBeNull();
    });

    it("fetches fresh balance on wallet reconnect and never reuses previous wallet balance", async () => {
      mockGetBalance
        .mockResolvedValueOnce(5_000_000_000) // Initial Wallet A: 5 SOL
        .mockResolvedValueOnce(1_000_000_000); // Reconnected Wallet A: 1 SOL

      let walletKey: string | null = WALLET_A;
      const { result, rerender } = renderHook(() =>
        useNomadEscrow({ walletPublicKey: walletKey })
      );

      await act(async () => {
        await result.current.fetchBalance();
      });
      expect(result.current.balance).toBe(5);

      // Disconnect
      walletKey = null;
      await act(async () => {
        rerender();
      });
      expect(result.current.balance).toBeNull();

      // Reconnect
      walletKey = WALLET_A;
      await act(async () => {
        rerender();
      });

      expect(result.current.balance).toBe(1);
      expect(result.current.balanceLamports).toBe(1_000_000_000);
      expect(mockGetBalance).toHaveBeenCalledTimes(2);
    });
  });

  describe("2. Wallet Switching and Isolation", () => {
    it("associates cached balance with wallet public key and switches balances correctly", async () => {
      mockGetBalance
        .mockResolvedValueOnce(10_000_000_000) // Wallet A: 10 SOL
        .mockResolvedValueOnce(500_000_000); // Wallet B: 0.5 SOL

      let walletKey: string | null = WALLET_A;
      const { result, rerender } = renderHook(() =>
        useNomadEscrow({ walletPublicKey: walletKey })
      );

      await act(async () => {
        await result.current.fetchBalance();
      });
      expect(result.current.balance).toBe(10);

      // Switch to Wallet B
      walletKey = WALLET_B;
      await act(async () => {
        rerender();
      });

      expect(result.current.balance).toBe(0.5);
      expect(result.current.balanceLamports).toBe(500_000_000);
    });
  });

  describe("3. Stale Asynchronous Response Protection", () => {
    it("discards slow/delayed balance responses if wallet changes before response arrives", async () => {
      let resolveSlowRequestA: (val: number) => void;
      const slowPromiseA = new Promise<number>((resolve) => {
        resolveSlowRequestA = resolve;
      });

      mockGetBalance.mockImplementation((pubkey: any) => {
        if (pubkey.toBase58() === WALLET_A) {
          return slowPromiseA;
        }
        return Promise.resolve(7_000_000_000); // Fast Wallet B: 7 SOL
      });

      let walletKey: string | null = WALLET_A;
      const { result, rerender } = renderHook(() =>
        useNomadEscrow({ walletPublicKey: walletKey })
      );

      // Initiate slow fetch for Wallet A
      act(() => {
        result.current.fetchBalance(true);
      });

      // Switch to Wallet B before Wallet A finishes
      walletKey = WALLET_B;
      await act(async () => {
        rerender();
      });

      expect(result.current.balance).toBe(7);

      // Now resolve the stale Wallet A request
      await act(async () => {
        resolveSlowRequestA!(99_000_000_000); // 99 SOL from Wallet A
      });

      // Wallet B's balance must NOT be overwritten by the delayed response from Wallet A
      expect(result.current.balance).toBe(7);
      expect(result.current.balanceLamports).toBe(7_000_000_000);
    });
  });

  describe("4. Preflight Balance Verification", () => {
    it("returns allowed: true when fresh balance is sufficient for required lamports", async () => {
      mockGetBalance.mockResolvedValue(3_000_000_000); // 3 SOL

      const { result } = renderHook(() =>
        useNomadEscrow({ walletPublicKey: WALLET_A })
      );

      let preflight: any;
      await act(async () => {
        preflight = await result.current.checkBalancePreflight(1_000_000_000); // Requires 1 SOL
      });

      expect(preflight.allowed).toBe(true);
      expect(preflight.balanceLamports).toBe(3_000_000_000);
      expect(preflight.requiredLamports).toBe(1_000_000_000);
    });

    it("returns allowed: false when fresh balance is insufficient", async () => {
      mockGetBalance.mockResolvedValue(500_000_000); // 0.5 SOL

      const { result } = renderHook(() =>
        useNomadEscrow({ walletPublicKey: WALLET_A })
      );

      let preflight: any;
      await act(async () => {
        preflight = await result.current.checkBalancePreflight(1_000_000_000); // Requires 1 SOL
      });

      expect(preflight.allowed).toBe(false);
      expect(preflight.error).toContain("Insufficient balance");
    });

    it("returns allowed: false when wallet is disconnected", async () => {
      const { result } = renderHook(() =>
        useNomadEscrow({ walletPublicKey: null })
      );

      let preflight: any;
      await act(async () => {
        preflight = await result.current.checkBalancePreflight(1_000_000_000);
      });

      expect(preflight.allowed).toBe(false);
      expect(preflight.error).toContain("Wallet is not connected");
    });
  });

  describe("5. Failed Balance Requests & Error Handling", () => {
    it("handles RPC network failures gracefully without crashing", async () => {
      mockGetBalance.mockRejectedValue(new Error("RPC 429 Too Many Requests"));

      const { result } = renderHook(() =>
        useNomadEscrow({ walletPublicKey: WALLET_A })
      );

      await act(async () => {
        const bal = await result.current.fetchBalance(true);
        expect(bal).toBeNull();
      });

      expect(result.current.balance).toBeNull();
      expect(result.current.balanceError).toContain("RPC 429 Too Many Requests");
      expect(result.current.isLoadingBalance).toBe(false);
    });
  });
});
