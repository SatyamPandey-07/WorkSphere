import { POST } from "@/app/api/folders/join/route";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    folderInvite: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    folderMember: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe("POST /api/folders/join", () => {
  const mockAuth = auth as unknown as jest.Mock;
  const mockCurrentUser = currentUser as unknown as jest.Mock;
  const mockFindUnique = prisma.folderInvite.findUnique as jest.Mock;
  const mockUpdate = prisma.folderInvite.update as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockCurrentUser.mockResolvedValue({
      emailAddresses: [{ emailAddress: "guest@example.com" }],
    });
  });

  it("returns 410 with an expired message instead of 500", async () => {
    mockFindUnique.mockResolvedValue({
      id: "inv_1",
      folderId: "folder_1",
      email: "guest@example.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      folder: { id: "folder_1", name: "Team desks" },
    });
    mockUpdate.mockResolvedValue({});

    const req = {
      json: async () => ({
        token: "a".repeat(32),
      }),
    } as any;

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toMatch(/expired/i);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: { status: "EXPIRED" },
    });
  });

  it("still returns 410 when marking the invite expired fails", async () => {
    mockFindUnique.mockResolvedValue({
      id: "inv_2",
      folderId: "folder_1",
      email: "guest@example.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      folder: { id: "folder_1", name: "Team desks" },
    });
    mockUpdate.mockRejectedValue(new Error("db write failed"));

    const req = {
      json: async () => ({
        token: "b".repeat(32),
      }),
    } as any;

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toMatch(/expired/i);
  });
});
