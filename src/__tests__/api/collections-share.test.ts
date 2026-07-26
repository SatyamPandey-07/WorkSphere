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
      update: jest.fn(),
    },
  },
}));

describe("POST /api/collections/public/share", () => {
  const mockAuth = auth as unknown as jest.Mock;
  const mockHasFolderAccess = hasFolderAccess as unknown as jest.Mock;
  const mockFolderUpdate = prisma.folder.update as jest.Mock;

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
      folder: { id: "folder_1", inviteToken: null },
      hasAccess: true,
      role: "MEMBER",
    });
    const req = {
      json: async () => ({ folderId: "folder_1" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("should generate a token and return 200 on success", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: { id: "folder_1", inviteToken: null, isPublic: false },
      hasAccess: true,
      role: "OWNER",
    });
    mockFolderUpdate.mockResolvedValue({});

    const req = {
      json: async () => ({ folderId: "folder_1" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.token.length).toBe(12); // length of a 6-byte hex token is 12 characters
    expect(mockFolderUpdate).toHaveBeenCalledWith({
      where: { id: "folder_1" },
      data: {
        inviteToken: body.token,
        isPublic: true,
      },
    });
  });

  it("should reuse the existing token if it already exists", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: { id: "folder_1", inviteToken: "existing_token", isPublic: false },
      hasAccess: true,
      role: "EDITOR",
    });
    mockFolderUpdate.mockResolvedValue({});

    const req = {
      json: async () => ({ folderId: "folder_1" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBe("existing_token");
    expect(mockFolderUpdate).toHaveBeenCalledWith({
      where: { id: "folder_1" },
      data: {
        isPublic: true,
      },
    });
  });
});
