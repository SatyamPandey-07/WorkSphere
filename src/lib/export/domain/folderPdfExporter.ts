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
import { wrapText } from "@/lib/pdf/generateBookingPdf";

export type FolderPdfVenue = {
  name: string;
  wifiQuality: number | null;
  hasOutlets: boolean;
  notes?: string | null;
  address?: string | null;
};

export async function generateFolderSummaryPdf(options?: {
  folderName?: string;
  folderDescription?: string | null;
  venues?: FolderPdfVenue[];
}): Promise<Uint8Array> {
  const safeOptions = options || {};
  const folderName = safeOptions.folderName
    ? String(safeOptions.folderName).trim()
    : "Workspace Collection";
  const folderDescription = safeOptions.folderDescription
    ? String(safeOptions.folderDescription).trim()
    : null;
  const venues = Array.isArray(safeOptions.venues)
    ? safeOptions.venues.filter((v): v is FolderPdfVenue => v != null)
    : [];

  const builder = await PdfDocumentBuilder.create({
    accentColor: { r: 0.23, g: 0.51, b: 0.96 },
    margin: 48,
    title: "WorkSphere Collection Report",
  });

  const { boldFont, font } = builder;
  const margin = builder.margin;
  const availableWidth = builder.pageWidth - margin * 2;

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
    const descLines = wrapText(
      safeText(folderDescription),
      font,
      10,
      availableWidth,
    );
    for (const dLine of descLines) {
      builder.ensureSpace(14);
      builder.drawText(dLine, {
        size: 10,
        font,
        color: rgb(0.4, 0.4, 0.4),
        decrementY: 14,
      });
    }
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

  if (venues.length === 0) {
    builder.ensureSpace(50);
    builder.drawText("No venues saved in this collection yet.", {
      size: 10,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    builder.addPageNumbers();
    return await builder.build();
  }

  // Venues List
  for (const v of venues) {
    builder.ensureSpace(50);

    const venueName = v.name ? String(v.name) : "Unnamed Workspace";
    builder.drawText(safeText(venueName), {
      size: 11,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });

    const isNumericWifi =
      typeof v.wifiQuality === "number" &&
      Number.isFinite(v.wifiQuality) &&
      v.wifiQuality >= 0;
    const wifiStr = isNumericWifi ? `★ ${v.wifiQuality}/5 WiFi` : "WiFi: N/A";
    const outletStr = v.hasOutlets ? "Power Outlets Available" : "No Outlets";
    builder.drawText(`${wifiStr}  ·  ${outletStr}`, {
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });

    if (v.address) {
      const addressStr =
        typeof v.address === "string" ? v.address : String(v.address);
      const addressLines = wrapText(
        safeText(addressStr),
        font,
        8,
        availableWidth,
      );
      for (const aLine of addressLines) {
        builder.ensureSpace(12);
        builder.drawText(aLine, {
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
          decrementY: 12,
        });
      }
    }

    if (v.notes) {
      const notesStr =
        typeof v.notes === "string" ? v.notes : String(v.notes);
      const noteLines = wrapText(
        safeText(`Notes: ${notesStr}`),
        font,
        8,
        availableWidth,
      );
      for (const nLine of noteLines) {
        builder.ensureSpace(12);
        builder.drawText(nLine, {
          size: 8,
          font,
          color: rgb(0.35, 0.35, 0.35),
          decrementY: 12,
        });
      }
    }

    builder.currentY -= 6;
  }

  builder.addPageNumbers();
  return await builder.build();
}
