/**
 * Folder Collection Summary Exporter (PDF).
 *
 * Generates PDF reports for saved venue folders and collections using PdfDocumentBuilder.
 */

import {
  PdfDocumentBuilder,
  drawSafeText,
  safeText,
} from "../pdfBuilder";
import { rgb } from "pdf-lib";

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

  const builder = await PdfDocumentBuilder.create({
    accentColor: { r: 0.23, g: 0.51, b: 0.96 },
    margin: 48,
    title: "WorkSphere Collection Report",
  });

  const { boldFont, font } = builder;
  const margin = builder.margin;

  // Header Title
  builder.drawHeading("WorkSphere Collection Report", undefined, {
    titleSize: 18,
    color: rgb(0.1, 0.1, 0.1),
  });

  builder.drawText(safeText(folderName), {
    size: 14,
    font: boldFont,
    color: rgb(0.15, 0.15, 0.15),
  });

  if (folderDescription) {
    builder.drawText(safeText(folderDescription).slice(0, 90), {
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  builder.drawText(
    `Generated ${new Date().toLocaleDateString()}  ·  ${venues.length} venue${venues.length === 1 ? "" : "s"}`,
    {
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    },
  );

  builder.drawDivider();

  // Venues List
  for (const v of venues) {
    builder.ensureSpace(55);

    builder.drawText(safeText(v.name), {
      size: 11,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });

    const wifiStr = v.wifiQuality ? `★ ${v.wifiQuality}/5 WiFi` : "WiFi: N/A";
    const outletStr = v.hasOutlets ? "Power Outlets Available" : "No Outlets";
    builder.drawText(`${wifiStr}  ·  ${outletStr}`, {
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });

    if (v.address) {
      builder.drawText(safeText(v.address).slice(0, 80), {
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    if (v.notes) {
      builder.drawText(`Notes: ${safeText(v.notes).slice(0, 100)}`, {
        size: 8,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    }

    builder.currentY -= 6;
  }

  builder.addPageNumbers();
  return await builder.build();
}
