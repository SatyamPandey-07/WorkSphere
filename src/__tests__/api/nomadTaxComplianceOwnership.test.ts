/** @jest-environment node */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GET } from "@/app/api/tax/nomad-compliance/route";
import { prisma } from "@/lib/prisma";
import {
  generateNomadComplianceReport,
  generateNomadTaxAuditPdf,
} from "@/lib/tax/nomadTaxEngine";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/tax/nomadTaxEngine", () => ({
  generateNomadComplianceReport: jest.fn(),
  exportComplianceReportCSV: jest.fn(),
  calculateNomadTaxPresence: jest.fn(),
  generateNomadTaxAuditPdf: jest.fn(),
}));

const mockAuth = auth as jest.Mock;
const mockFindBookings = prisma.booking.findMany as jest.Mock;
const mockGenerateReport = generateNomadComplianceReport as jest.Mock;
const mockGeneratePdf = generateNomadTaxAuditPdf as jest.Mock;

const report = {
  taxYear: 2025,
};

function makeRequest(query = "year=2025"): NextRequest {
  return new NextRequest(`http://localhost/api/tax/nomad-compliance?${query}`);
}

describe("GET /api/tax/nomad-compliance - ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockAuth.mockResolvedValue({ userId: "user-a" });
    mockFindBookings.mockResolvedValue([]);
    mockGenerateReport.mockReturnValue(report);
    mockGeneratePdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("returns 401 before accessing bookings when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized",
    });

    expect(mockFindBookings).not.toHaveBeenCalled();
    expect(mockGenerateReport).not.toHaveBeenCalled();
  });

  it("scopes booking retrieval to the authenticated user", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);

    expect(mockFindBookings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-a" },
      }),
    );

    expect(mockGenerateReport).toHaveBeenCalledWith(expect.any(Array), 2025);
  });

  it("rejects a mismatched userId without querying private bookings", async () => {
    const response = await GET(makeRequest("year=2025&userId=user-b"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Not Found",
    });

    expect(mockFindBookings).not.toHaveBeenCalled();
    expect(mockGenerateReport).not.toHaveBeenCalled();
    expect(mockGeneratePdf).not.toHaveBeenCalled();
  });

  it("uses the authenticated identity when generating a PDF", async () => {
    const response = await GET(makeRequest("year=2025&format=pdf"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");

    expect(mockGeneratePdf).toHaveBeenCalledWith(report, {
      userId: "user-a",
    });
  });
});
