import { generateFolderSummaryPdf } from "@/lib/folderPdfExport";
import { PDFDocument } from "pdf-lib";

describe("generateFolderSummaryPdf", () => {
  it("builds a PDF with venue wifi, outlets, and notes", async () => {
    const bytes = await generateFolderSummaryPdf({
      folderName: "Team Hubs",
      folderDescription: "Places we like",
      venues: [
        {
          name: "Focus Cafe",
          wifiQuality: 5,
          hasOutlets: true,
          notes: "Quiet mornings",
          address: "123 Main St, Suite 400",
        },
        {
          name: "Library Annex",
          wifiQuality: null,
          hasOutlets: false,
          notes: "",
        },
      ],
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("handles an empty folder safely with empty state message", async () => {
    const bytes = await generateFolderSummaryPdf({
      folderName: "Empty List",
      venues: [],
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("handles null or undefined options safely without throwing", async () => {
    const bytesNull = await generateFolderSummaryPdf(null as any);
    expect(bytesNull).toBeInstanceOf(Uint8Array);
    expect(bytesNull.length).toBeGreaterThan(100);

    const bytesUndef = await generateFolderSummaryPdf(undefined);
    expect(bytesUndef).toBeInstanceOf(Uint8Array);
    expect(bytesUndef.length).toBeGreaterThan(100);
  });

  it("wraps long descriptions, addresses, and notes across lines without clipping", async () => {
    const longDesc =
      "Curated collection of high-performance coworking spaces and quiet cafes tailored for distributed engineering teams working across European and Asian timezones with dedicated private booths and ergonomic desks.";
    const longAddress =
      "Building 4, Cyberport Campus Phase 2, 100 Cyberport Road, Telegraph Bay, Southern District, Hong Kong Island, Special Administrative Region";
    const longNotes =
      "Ultra-quiet second floor library area with Herman Miller Aeron chairs, high-speed fiber connection (1 Gbps symmetric), and free organic specialty coffee at the barista bar.";

    const bytes = await generateFolderSummaryPdf({
      folderName: "Nomad Elite Spaces",
      folderDescription: longDesc,
      venues: [
        {
          name: "Cyberport Tech Workspace",
          wifiQuality: 5,
          hasOutlets: true,
          address: longAddress,
          notes: longNotes,
        },
      ],
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(500);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("skips nullish venue elements and safely formats zero or NaN wifiQuality", async () => {
    const dirtyVenues = [
      null,
      undefined,
      {
        name: "Zero Star Cafe",
        wifiQuality: 0,
        hasOutlets: true,
        address: null,
      },
      {
        name: "Corrupted Wifi Hub",
        wifiQuality: NaN as any,
        hasOutlets: false,
        notes: null,
      },
    ];

    const bytes = await generateFolderSummaryPdf({
      folderName: "Edge Case Collection",
      venues: dirtyVenues as any,
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
