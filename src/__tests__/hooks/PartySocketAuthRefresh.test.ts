import { renderHook, act } from "@testing-library/react";
import usePartySocketReconnect from "@/hooks/usePartySocketReconnect";

const mockGetToken = jest.fn();
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: mockGetToken,
  }),
}));

const mockCloseListeners: Array<(event: any) => void> = [];
const mockConnect = jest.fn();

jest.mock("partysocket/react", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    query: { token: "expired-token" },
    _connect: mockConnect,
    addEventListener: jest.fn((event: string, cb: (e: any) => void) => {
      if (event === "close") {
        mockCloseListeners.push(cb);
      }
    }),
    removeEventListener: jest.fn(),
  })),
}));

describe("PartySocket Expired Clerk Token Re-authentication (#1750)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCloseListeners.length = 0;
  });

  it("intercepts 4001 auth closure code, fetches fresh Clerk JWT token, and forces reconnection", async () => {
    mockGetToken.mockResolvedValueOnce("fresh-clerk-jwt-token");

    const { result } = renderHook(() =>
      usePartySocketReconnect({ host: "localhost:1999", room: "test-room" }),
    );

    expect(result.current).toBeDefined();
    expect(mockCloseListeners.length).toBeGreaterThan(0);

    // Simulate WebSocket close event with code 4001 (Unauthorized: Token expired)
    await act(async () => {
      for (const listener of mockCloseListeners) {
        await listener({ code: 4001, reason: "Unauthorized: Token expired" });
      }
    });

    expect(mockGetToken).toHaveBeenCalledWith({ skipCache: true });
    expect((result.current as any).query?.token).toBe("fresh-clerk-jwt-token");
    expect(mockConnect).toHaveBeenCalled();
  });
});
