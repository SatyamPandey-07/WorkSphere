import { generateFolderSummaryPdf } from "@/lib/folderPdfExport";

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

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFDocument } = require("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("handles an empty folder", async () => {
    const bytes = await generateFolderSummaryPdf({
      folderName: "Empty List",
      venues: [],
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
