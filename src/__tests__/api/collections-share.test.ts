import { POST } from "@/app/api/collections/public/share/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/folders", () => ({
  hasFolderAccess: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    folder: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

describe("POST /api/collections/public/share", () => {
  const mockAuth = auth as unknown as jest.Mock;
  const mockHasFolderAccess = hasFolderAccess as unknown as jest.Mock;
  const mockFolderUpdateMany = prisma.folder.updateMany as jest.Mock;
  const mockFolderFindUnique = prisma.folder.findUnique as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 if unauthorized", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const req = {
      json: async () => ({ folderId: "folder_1" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("should return 400 if folderId is missing", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    const req = {
      json: async () => ({}),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 404 if folder not found", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({ folder: null, hasAccess: false });
    const req = {
      json: async () => ({ folderId: "folder_invalid" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("should return 403 if user role is not OWNER or EDITOR", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: { id: "folder_1", inviteToken: null, isPublic: false },
      hasAccess: true,
      role: "MEMBER",
    });
    const req = {
      json: async () => ({ folderId: "folder_1" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("should atomically claim an initial share token when inviteToken is null", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: { id: "folder_1", inviteToken: null, isPublic: false },
      hasAccess: true,
      role: "OWNER",
    });
    mockFolderUpdateMany.mockResolvedValue({ count: 1 });

    const req = {
      json: async () => ({ folderId: "folder_1" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.token.length).toBe(12);
    expect(mockFolderUpdateMany).toHaveBeenCalledWith({
      where: { id: "folder_1", inviteToken: null },
      data: {
        inviteToken: body.token,
        isPublic: true,
      },
    });
    expect(mockFolderFindUnique).not.toHaveBeenCalled();
  });

  it("should reuse the existing token and make the folder public if private", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: {
        id: "folder_1",
        inviteToken: "existing_token",
        isPublic: false,
      },
      hasAccess: true,
      role: "EDITOR",
    });
    mockFolderUpdateMany.mockResolvedValue({ count: 1 });

    const req = {
      json: async () => ({ folderId: "folder_1" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBe("existing_token");
    expect(mockFolderUpdateMany).toHaveBeenCalledWith({
      where: { id: "folder_1", isPublic: false },
      data: {
        isPublic: true,
      },
    });
  });

  it("should return the single canonical persisted token across concurrent first-time share requests", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });

    // Force all parallel requests to initially observe inviteToken === null (worst-case TOCTOU window)
    const dbFolder = {
      id: "folder_race",
      inviteToken: null as string | null,
      isPublic: false,
    };

    mockHasFolderAccess.mockImplementation(async () => {
      await Promise.resolve();
      return {
        folder: { id: dbFolder.id, inviteToken: null, isPublic: false },
        hasAccess: true,
        role: "OWNER",
      };
    });

    mockFolderUpdateMany.mockImplementation(async ({ where, data }) => {
      if (where.id !== dbFolder.id) return { count: 0 };
      if ("inviteToken" in where && where.inviteToken === null) {
        if (dbFolder.inviteToken !== null) {
          return { count: 0 };
        }
        dbFolder.inviteToken = data.inviteToken;
        if (typeof data.isPublic === "boolean") {
          dbFolder.isPublic = data.isPublic;
        }
        return { count: 1 };
      }
      if ("isPublic" in where && where.isPublic === false) {
        if (dbFolder.isPublic) return { count: 0 };
        dbFolder.isPublic = true;
        return { count: 1 };
      }
      return { count: 0 };
    });

    mockFolderFindUnique.mockImplementation(async ({ where }) => {
      if (where.id !== dbFolder.id) return null;
      return {
        inviteToken: dbFolder.inviteToken,
        isPublic: dbFolder.isPublic,
      };
    });

    const makeReq = () =>
      ({
        json: async () => ({ folderId: "folder_race" }),
      }) as any;

    const responses = await Promise.all([
      POST(makeReq()),
      POST(makeReq()),
      POST(makeReq()),
    ]);

    const bodies = await Promise.all(responses.map((r) => r.json()));

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const tokens = bodies.map((b) => b.token);
    expect(dbFolder.inviteToken).toBeTruthy();
    expect(dbFolder.isPublic).toBe(true);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toBe(dbFolder.inviteToken);
  });

  it("should recover canonical token and ensure isPublic=true when an existing token was written privately mid-race", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: { id: "folder_short", inviteToken: null, isPublic: false },
      hasAccess: true,
      role: "OWNER",
    });

    const dbFolder = {
      id: "folder_short",
      inviteToken: "short_created_token",
      isPublic: false,
    };

    mockFolderUpdateMany.mockImplementation(async ({ where }) => {
      if ("inviteToken" in where && where.inviteToken === null) {
        return { count: 0 };
      }
      if (
        "isPublic" in where &&
        where.isPublic === false &&
        !dbFolder.isPublic
      ) {
        dbFolder.isPublic = true;
        return { count: 1 };
      }
      return { count: 0 };
    });

    mockFolderFindUnique.mockResolvedValue({
      inviteToken: "short_created_token",
      isPublic: false,
    });

    const res = await POST({
      json: async () => ({ folderId: "folder_short" }),
    } as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.token).toBe("short_created_token");
    expect(dbFolder.isPublic).toBe(true);
  });

  it("should retry if candidate token hits a P2002 unique constraint collision", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: { id: "folder_1", inviteToken: null, isPublic: false },
      hasAccess: true,
      role: "OWNER",
    });

    const uniqueErr = Object.assign(new Error("Unique violation"), {
      code: "P2002",
    });
    mockFolderUpdateMany
      .mockRejectedValueOnce(uniqueErr)
      .mockResolvedValueOnce({ count: 1 });

    const res = await POST({
      json: async () => ({ folderId: "folder_1" }),
    } as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockFolderUpdateMany).toHaveBeenCalledTimes(2);
    expect(body.token).toHaveLength(12);
  });

  it("should return 404 if folder disappears before token assignment completes", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: { id: "folder_deleted", inviteToken: null, isPublic: false },
      hasAccess: true,
      role: "OWNER",
    });
    mockFolderUpdateMany.mockResolvedValue({ count: 0 });
    mockFolderFindUnique.mockResolvedValue(null);

    const res = await POST({
      json: async () => ({ folderId: "folder_deleted" }),
    } as any);

    expect(res.status).toBe(404);
  });
});
