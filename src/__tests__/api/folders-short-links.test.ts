import {
  GET as getShortLinks,
  POST as createShortLink,
} from "@/app/api/folders/[id]/short-links/route";
import { DELETE as deleteShortLink } from "@/app/api/folders/[id]/short-links/[linkId]/route";
import { GET as resolveShortLink } from "@/app/s/[shortCode]/route";
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
    shortLink: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    folder: {
      update: jest.fn(),
    },
  },
}));

describe("Folder Short Links API & Redirection", () => {
  const mockAuth = auth as unknown as jest.Mock;
  const mockHasFolderAccess = hasFolderAccess as unknown as jest.Mock;
  const mockFindManyShortLinks = (prisma as any).shortLink
    .findMany as jest.Mock;
  const mockFindUniqueShortLink = (prisma as any).shortLink
    .findUnique as jest.Mock;
  const mockCreateShortLink = (prisma as any).shortLink.create as jest.Mock;
  const mockDeleteShortLink = (prisma as any).shortLink.delete as jest.Mock;
  const mockUpdateFolder = prisma.folder.update as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/folders/[id]/short-links", () => {
    it("returns 401 if unauthorized", async () => {
      mockAuth.mockResolvedValue({ userId: null });
      const req = {} as any;
      const res = await getShortLinks(req, {
        params: Promise.resolve({ id: "folder_1" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 if folder not found", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({ folder: null, hasAccess: false });
      const req = {} as any;
      const res = await getShortLinks(req, {
        params: Promise.resolve({ id: "folder_invalid" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 403 if user is just a VIEWER", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({
        folder: { id: "folder_1" },
        hasAccess: true,
        role: "VIEWER",
      });
      const req = {} as any;
      const res = await getShortLinks(req, {
        params: Promise.resolve({ id: "folder_1" }),
      });
      expect(res.status).toBe(403);
    });

    it("returns short links list on success", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({
        folder: { id: "folder_1" },
        hasAccess: true,
        role: "OWNER",
      });
      const mockLinks = [
        { id: "link_1", shortCode: "custom", folderId: "folder_1" },
      ];
      mockFindManyShortLinks.mockResolvedValue(mockLinks);

      const req = {} as any;
      const res = await getShortLinks(req, {
        params: Promise.resolve({ id: "folder_1" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.shortLinks).toEqual(mockLinks);
    });
  });

  describe("POST /api/folders/[id]/short-links", () => {
    it("returns 400 for validation errors (e.g. invalid customCode characters)", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({
        folder: { id: "folder_1" },
        hasAccess: true,
        role: "OWNER",
      });
      const req = {
        json: async () => ({
          customCode: "invalid code!",
          expiration: "never",
        }),
      } as any;
      const res = await createShortLink(req, {
        params: Promise.resolve({ id: "folder_1" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 if customCode is a reserved word", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({
        folder: { id: "folder_1" },
        hasAccess: true,
        role: "OWNER",
      });
      const req = {
        json: async () => ({ customCode: "admin", expiration: "24h" }),
      } as any;
      const res = await createShortLink(req, {
        params: Promise.resolve({ id: "folder_1" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/reserved/i);
    });

    it("returns 409 if customCode is already in use", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({
        folder: { id: "folder_1" },
        hasAccess: true,
        role: "OWNER",
      });
      mockFindUniqueShortLink.mockResolvedValue({
        id: "link_existing",
        shortCode: "custom-code",
      });

      const req = {
        json: async () => ({ customCode: "custom-code", expiration: "never" }),
      } as any;
      const res = await createShortLink(req, {
        params: Promise.resolve({ id: "folder_1" }),
      });
      expect(res.status).toBe(409);
    });

    it("successfully creates a short link with custom code and 24h expiration", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({
        folder: {
          id: "folder_1",
          inviteToken: "existing_token",
          isPublic: true,
        },
        hasAccess: true,
        role: "EDITOR",
      });
      mockFindUniqueShortLink.mockResolvedValue(null);
      mockCreateShortLink.mockResolvedValue({
        id: "link_new",
        shortCode: "my-alias",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const req = {
        json: async () => ({ customCode: "my-alias", expiration: "24h" }),
      } as any;
      const res = await createShortLink(req, {
        params: Promise.resolve({ id: "folder_1" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.shortLink.shortCode).toBe("my-alias");
      expect(mockUpdateFolder).not.toHaveBeenCalled(); // Already public and has inviteToken
    });

    it("generates inviteToken but does not set isPublic to true if folder is private when creating a short link", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({
        folder: { id: "folder_1", inviteToken: null, isPublic: false },
        hasAccess: true,
        role: "OWNER",
      });
      mockFindUniqueShortLink.mockResolvedValue(null);
      mockCreateShortLink.mockResolvedValue({
        id: "link_new",
        shortCode: "random123",
      });

      const req = {
        json: async () => ({ expiration: "never" }),
      } as any;
      const res = await createShortLink(req, {
        params: Promise.resolve({ id: "folder_1" }),
      });
      expect(res.status).toBe(201);
      expect(mockUpdateFolder).toHaveBeenCalledWith({
        where: { id: "folder_1" },
        data: {
          inviteToken: expect.any(String),
        },
      });
    });
  });

  describe("DELETE /api/folders/[id]/short-links/[linkId]", () => {
    it("deletes a short link successfully", async () => {
      mockAuth.mockResolvedValue({ userId: "user_1" });
      mockHasFolderAccess.mockResolvedValue({
        folder: { id: "folder_1" },
        hasAccess: true,
        role: "OWNER",
      });
      mockFindUniqueShortLink.mockResolvedValue({
        id: "link_1",
        folderId: "folder_1",
      });

      const req = {} as any;
      const res = await deleteShortLink(req, {
        params: Promise.resolve({ id: "folder_1", linkId: "link_1" }),
      });
      expect(res.status).toBe(200);
      expect(mockDeleteShortLink).toHaveBeenCalledWith({
        where: { id: "link_1" },
      });
    });
  });

  describe("GET /s/[shortCode] (Redirection)", () => {
    it("returns 404 styled HTML page if short code does not exist", async () => {
      mockFindUniqueShortLink.mockResolvedValue(null);

      const req = { url: "http://localhost/s/absent" } as any;
      const res = await resolveShortLink(req, {
        params: Promise.resolve({ shortCode: "absent" }),
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("text/html");
      const html = await res.text();
      expect(html).toContain("Link Expired or Not Found");
    });

    it("returns 404 styled HTML page if short link is expired", async () => {
      mockFindUniqueShortLink.mockResolvedValue({
        shortCode: "old-link",
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
        folder: { id: "folder_1", inviteToken: "token", isPublic: true },
      });

      const req = { url: "http://localhost/s/old-link" } as any;
      const res = await resolveShortLink(req, {
        params: Promise.resolve({ shortCode: "old-link" }),
      });
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).toContain("Link Expired or Not Found");
    });

    it("redirects to public collection view if short link is valid", async () => {
      mockFindUniqueShortLink.mockResolvedValue({
        shortCode: "quick-link",
        expiresAt: null, // Never expires
        folder: { id: "folder_1", inviteToken: "token123", isPublic: true },
      });

      const req = { url: "http://localhost/s/quick-link" } as any;
      const res = await resolveShortLink(req, {
        params: Promise.resolve({ shortCode: "quick-link" }),
      });
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(
        "http://localhost/collections/public/token123?s=quick-link",
      );
    });

    it("redirects to public collection view if short link is valid even if folder is private", async () => {
      mockFindUniqueShortLink.mockResolvedValue({
        shortCode: "quick-link",
        expiresAt: null, // Never expires
        folder: { id: "folder_1", inviteToken: "token123", isPublic: false },
      });

      const req = { url: "http://localhost/s/quick-link" } as any;
      const res = await resolveShortLink(req, {
        params: Promise.resolve({ shortCode: "quick-link" }),
      });
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(
        "http://localhost/collections/public/token123?s=quick-link",
      );
    });
  });
});
