import { GET } from "@/app/api/folders/[id]/export-billing/route";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/folders", () => ({
  hasFolderAccess: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    folderVenue: {
      findMany: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
  },
}));

describe("GET /api/folders/[id]/export-billing role-based access control", () => {
  const mockFolder = {
    id: "folder-123",
    name: "Engineering Offsites",
    ownerId: "owner-1",
    isPublic: true,
  };

  const createRequest = () =>
    new NextRequest(
      "http://localhost:3000/api/folders/folder-123/export-billing",
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ id: "folder-123" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 404 when folder is not found", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user-unknown" });
    (hasFolderAccess as jest.Mock).mockResolvedValue({
      folder: null,
      hasAccess: false,
      role: null,
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ id: "folder-123" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 403 when user has no access to folder", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user-stranger" });
    (hasFolderAccess as jest.Mock).mockResolvedValue({
      folder: mockFolder,
      hasAccess: false,
      role: null,
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ id: "folder-123" }),
    });

    expect(res.status).toBe(403);
  });

  it("returns 403 when user is only a public folder VIEWER", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user-viewer" });
    (hasFolderAccess as jest.Mock).mockResolvedValue({
      folder: mockFolder,
      hasAccess: true,
      role: "VIEWER",
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ id: "folder-123" }),
    });

    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("Forbidden");
  });

  it("returns 403 when user is a regular folder MEMBER", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user-member" });
    (hasFolderAccess as jest.Mock).mockResolvedValue({
      folder: mockFolder,
      hasAccess: true,
      role: "MEMBER",
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ id: "folder-123" }),
    });

    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain("Forbidden");
  });

  it("allows export and returns CSV when user is an authorized EDITOR", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "user-editor" });
    (hasFolderAccess as jest.Mock).mockResolvedValue({
      folder: mockFolder,
      hasAccess: true,
      role: "EDITOR",
    });

    (prisma.folderVenue.findMany as jest.Mock).mockResolvedValue([
      { venueId: "venue-1" },
    ]);
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      {
        date: "2026-11-20",
        duration: 90,
        confirmationId: "CONF-99",
        projectBillingCode: "ACME-CORP",
        customerEmail: "client@acme.com",
        venue: { name: "Acme Hall" },
        user: { firstName: "Jane", lastName: "Doe", email: "jane@acme.com" },
      },
    ]);

    const res = await GET(createRequest(), {
      params: Promise.resolve({ id: "folder-123" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");
    const csv = await res.text();
    expect(csv).toContain("Date,Venue Name,User Name,User Email");
    expect(csv).toContain("Jane Doe");
    expect(csv).toContain("ACME-CORP");
  });

  it("allows export and returns CSV when user is the folder OWNER", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "owner-1" });
    (hasFolderAccess as jest.Mock).mockResolvedValue({
      folder: mockFolder,
      hasAccess: true,
      role: "OWNER",
    });

    (prisma.folderVenue.findMany as jest.Mock).mockResolvedValue([
      { venueId: "venue-1" },
    ]);
    (prisma.booking.findMany as jest.Mock).mockResolvedValue([
      {
        date: "2026-11-20",
        duration: 60,
        confirmationId: "CONF-100",
        projectBillingCode: "PROJ-100",
        customerEmail: "owner@work.com",
        venue: { name: "HQ Workspace" },
        user: {
          firstName: "Alice",
          lastName: "Smith",
          email: "alice@work.com",
        },
      },
    ]);

    const res = await GET(createRequest(), {
      params: Promise.resolve({ id: "folder-123" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");
    const csv = await res.text();
    expect(csv).toContain("Alice Smith");
    expect(csv).toContain("PROJ-100");
  });
});
