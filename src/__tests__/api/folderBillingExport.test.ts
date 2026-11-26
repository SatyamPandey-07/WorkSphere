import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { hasFolderAccess } from "@/lib/folders";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/folders/[id]/export-billing/route";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/folders", () => ({
  hasFolderAccess: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    folderVenue: { findMany: jest.fn() },
    booking: { findMany: jest.fn() },
  },
}));

describe("GET /api/folders/[id]/export-billing", () => {
  const mockAuth = auth as unknown as jest.Mock;
  const mockHasFolderAccess = hasFolderAccess as unknown as jest.Mock;
  const mockFindFolderVenues = prisma.folderVenue
    .findMany as unknown as jest.Mock;
  const mockFindBookings = prisma.booking.findMany as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_1" });
    mockHasFolderAccess.mockResolvedValue({
      folder: { name: "../../Finance/West Team\r\nX-Injected: 1" },
      hasAccess: true,
    });
    mockFindFolderVenues.mockResolvedValue([]);
    mockFindBookings.mockResolvedValue([]);
  });

  it("returns a sanitized CSV download filename in both disposition parameters", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/folders/folder_1/export-billing"),
      { params: Promise.resolve({ id: "folder_1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv");

    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(
      /^attachment; filename="([a-zA-Z0-9_-]+\.csv)"; filename\*=UTF-8''([a-zA-Z0-9_-]+\.csv)$/,
    );
    const [, filename, encodedFilename] = disposition.match(
      /^attachment; filename="([a-zA-Z0-9_-]+\.csv)"; filename\*=UTF-8''(.+)$/,
    )!;
    expect(encodedFilename).toBe(encodeURIComponent(filename));
    expect(filename).not.toContain("..");
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
  });

  it("preserves the authentication gate before loading folder data", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const response = await GET(
      new NextRequest("http://localhost/api/folders/folder_1/export-billing"),
      { params: Promise.resolve({ id: "folder_1" }) },
    );

    expect(response.status).toBe(401);
    expect(mockHasFolderAccess).not.toHaveBeenCalled();
    expect(mockFindFolderVenues).not.toHaveBeenCalled();
  });
});
