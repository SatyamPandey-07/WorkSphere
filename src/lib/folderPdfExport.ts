import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { drawSafeText, safeText } from "@/lib/pdfHelpers";

export type FolderPdfVenue = {
  name: string;
  wifiQuality: number | null;
  hasOutlets: boolean;
  notes?: string | null;
  address?: string | null;
};

export async function generateFolderSummaryPdf(options: {
  folderName: string;
  folderDescription?: string | null;
  venues: FolderPdfVenue[];
}): Promise<Uint8Array> {
  const { folderName, folderDescription, venues } = options;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const margin = 48;
  let y = height - margin;

  const newPage = () => {
    page = pdfDoc.addPage([595, 842]);
    y = height - margin;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) newPage();
  };

  page.drawRectangle({
    x: 0,
    y: height - 8,
    width,
    height: 8,
    color: rgb(0.23, 0.51, 0.96),
  });

  drawSafeText(page, "WorkSphere Collection Report", {
    x: margin,
    y,
    size: 18,
    font: bold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 28;

  drawSafeText(page, safeText(folderName), {
    x: margin,
    y,
    size: 14,
    font: bold,
    color: rgb(0.15, 0.15, 0.15),
  });
  y -= 18;

  if (folderDescription) {
    drawSafeText(page, safeText(folderDescription).slice(0, 90), {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 16;
  }

  drawSafeText(
    page,
    `Generated ${new Date().toLocaleDateString()}  ·  ${venues.length} venue${venues.length === 1 ? "" : "s"}`,
    {
      x: margin,
      y,
      size: 9,
      font,
      color: rgb(0.45, 0.45, 0.45),
    },
  );
  y -= 28;

  if (venues.length === 0) {
    drawSafeText(page, "No venues in this collection.", {
      x: margin,
      y,
      size: 11,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    return pdfDoc.save();
  }

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    ensureSpace(72);

    drawSafeText(page, `${i + 1}. ${safeText(venue.name)}`, {
      x: margin,
      y,
      size: 12,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 16;

    const wifi = venue.wifiQuality != null ? `${venue.wifiQuality}/5` : "N/A";
    const outlets = venue.hasOutlets ? "Yes" : "No";

    drawSafeText(page, `WiFi: ${wifi}    Outlets: ${outlets}`, {
      x: margin + 8,
      y,
      size: 10,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
    y -= 14;

    const notes = (venue.notes || "").trim() || "—";
    const notesLine = `Notes: ${safeText(notes).slice(0, 100)}`;
    drawSafeText(page, notesLine, {
      x: margin + 8,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 22;
  }

  return pdfDoc.save();
}
