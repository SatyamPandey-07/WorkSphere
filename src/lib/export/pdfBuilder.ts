/**
 * Base PDF Document Builder with shared styling, glyph sanitization,
 * logo rendering, table drawing, and automated page numbering.
 */

import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb, RGB } from "pdf-lib";
import { sanitizeMathSymbols, sanitizeCurrencyForPDF } from "@/lib/pdfUtils";
import { triggerBrowserDownload } from "./csvBuilder";
import { PdfBuilderOptions } from "./types";

export { sanitizeMathSymbols, sanitizeCurrencyForPDF };

export const safeText = (text: string | null | undefined): string =>
  text ? sanitizeMathSymbols(text) : "";

export function safeWidthOfTextAtSize(
  text: string,
  font: PDFFont | any,
  size: number,
): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    const asciiText = text.replace(/[^\x20-\x7E]/g, "");
    try {
      return font.widthOfTextAtSize(asciiText, size);
    } catch {
      return asciiText.length * size * 0.6;
    }
  }
}

export function truncateText(
  text: string,
  font: any,
  size: number,
  maxWidth: number,
): string {
  const sanitized = safeText(text);
  if (safeWidthOfTextAtSize(sanitized, font, size) <= maxWidth) {
    return sanitized;
  }

  const ellipsis = "...";
  const ellipsisWidth = safeWidthOfTextAtSize(ellipsis, font, size);

  if (maxWidth <= ellipsisWidth) {
    return ellipsis;
  }

  let low = 0;
  let high = sanitized.length;
  let result = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const substring = sanitized.slice(0, mid) + ellipsis;
    const width = safeWidthOfTextAtSize(substring, font, size);

    if (width <= maxWidth) {
      result = substring;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result || ellipsis;
}

export function drawSafeText(
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    size: number;
    font: PDFFont | any;
    color?: RGB | any;
    maxWidth?: number;
  },
) {
  const sanitized = sanitizeMathSymbols(text);
  try {
    page.drawText(sanitized, options);
  } catch {
    try {
      const strictText = sanitized.replace(/[^\x20-\x7E]/g, "");
      page.drawText(strictText, options);
    } catch (fallbackErr) {
      console.error("[PDF drawSafeText error]:", fallbackErr);
    }
  }
}

export class PdfDocumentBuilder {
  public pdfDoc!: PDFDocument;
  public font!: PDFFont;
  public boldFont!: PDFFont;
  public pages: PDFPage[] = [];
  public currentPage!: PDFPage;
  public currentY = 0;
  public margin = 40;
  public pageWidth = 595;
  public pageHeight = 842;
  public accentColor: RGB = rgb(0.23, 0.51, 0.96);

  public static async create(
    options: PdfBuilderOptions = {},
  ): Promise<PdfDocumentBuilder> {
    const builder = new PdfDocumentBuilder();
    await builder.initialize(options);
    return builder;
  }

  public async initialize(options: PdfBuilderOptions = {}): Promise<this> {
    this.pdfDoc = await PDFDocument.create();
    this.font = await this.pdfDoc.embedFont(StandardFonts.Helvetica);
    this.boldFont = await this.pdfDoc.embedFont(StandardFonts.HelveticaBold);

    this.pageWidth = options.pageSize?.[0] ?? 595;
    this.pageHeight = options.pageSize?.[1] ?? 842;
    this.margin = options.margin ?? 40;

    if (options.accentColor) {
      this.accentColor = rgb(
        options.accentColor.r,
        options.accentColor.g,
        options.accentColor.b,
      );
    }

    if (options.title) this.pdfDoc.setTitle(options.title);
    if (options.author) this.pdfDoc.setAuthor(options.author);
    if (options.subject) this.pdfDoc.setSubject(options.subject);

    this.addPage();
    return this;
  }

  public addPage(options?: {
    drawAccentBar?: boolean;
    accentColor?: RGB;
  }): PDFPage {
    const page = this.pdfDoc.addPage([this.pageWidth, this.pageHeight]);
    this.pages.push(page);
    this.currentPage = page;
    this.currentY = this.pageHeight - this.margin;

    const shouldDrawAccent = options?.drawAccentBar ?? true;
    if (shouldDrawAccent) {
      const color = options?.accentColor ?? this.accentColor;
      page.drawRectangle({
        x: 0,
        y: this.pageHeight - 8,
        width: this.pageWidth,
        height: 8,
        color,
      });
    }

    return page;
  }

  public ensureSpace(neededHeight: number): boolean {
    if (this.currentY - neededHeight < this.margin + 30) {
      this.addPage();
      return true;
    }
    return false;
  }

  public drawHeading(
    title: string,
    subtitle?: string,
    options?: { titleSize?: number; color?: RGB },
  ): this {
    const titleSize = options?.titleSize ?? 18;
    drawSafeText(this.currentPage, title, {
      x: this.margin,
      y: this.currentY,
      size: titleSize,
      font: this.boldFont,
      color: options?.color ?? rgb(0.1, 0.1, 0.1),
    });
    this.currentY -= titleSize + 8;

    if (subtitle) {
      drawSafeText(this.currentPage, subtitle, {
        x: this.margin,
        y: this.currentY,
        size: 9,
        font: this.font,
        color: rgb(0.4, 0.4, 0.4),
      });
      this.currentY -= 16;
    }

    return this;
  }

  public drawLogo(
    x = this.margin,
    y = this.currentY,
    size = 20,
    color = this.accentColor,
  ): this {
    // Renders clean geometric WorkSphere icon badge
    this.currentPage.drawRectangle({
      x,
      y: y - size + 4,
      width: size,
      height: size,
      color,
    });
    drawSafeText(this.currentPage, "W", {
      x: x + size * 0.25,
      y: y - size * 0.75 + 4,
      size: size * 0.7,
      font: this.boldFont,
      color: rgb(1, 1, 1),
    });
    return this;
  }

  public drawDivider(options?: { y?: number; color?: RGB }): this {
    const yPos = options?.y ?? this.currentY;
    this.currentPage.drawLine({
      start: { x: this.margin, y: yPos },
      end: { x: this.pageWidth - this.margin, y: yPos },
      thickness: 0.5,
      color: options?.color ?? rgb(0.85, 0.85, 0.85),
    });
    this.currentY = yPos - 12;
    return this;
  }

  public drawText(
    text: string,
    options: {
      size?: number;
      font?: PDFFont;
      color?: RGB;
      x?: number;
      y?: number;
      decrementY?: number;
    } = {},
  ): this {
    const size = options.size ?? 10;
    const font = options.font ?? this.font;
    const color = options.color ?? rgb(0.2, 0.2, 0.2);
    const x = options.x ?? this.margin;
    const y = options.y ?? this.currentY;

    drawSafeText(this.currentPage, text, {
      x,
      y,
      size,
      font,
      color,
    });

    if (options.y === undefined) {
      this.currentY -= options.decrementY ?? size + 6;
    }

    return this;
  }

  /**
   * Adds page numbering to all pages (e.g., "Page 1 of 3").
   */
  public addPageNumbers(
    formatter: (page: number, total: number) => string = (p, t) =>
      `Page ${p} of ${t}`,
    options?: { color?: RGB; fontSize?: number },
  ): this {
    const total = this.pages.length;
    const color = options?.color ?? rgb(0.5, 0.5, 0.5);
    const size = options?.fontSize ?? 8;

    for (let i = 0; i < total; i++) {
      const page = this.pages[i];
      const pageNumText = formatter(i + 1, total);
      const textWidth = safeWidthOfTextAtSize(pageNumText, this.font, size);

      drawSafeText(page, pageNumText, {
        x: this.pageWidth - this.margin - textWidth,
        y: this.margin / 2,
        size,
        font: this.font,
        color,
      });
    }
    return this;
  }

  public async build(): Promise<Uint8Array> {
    return await this.pdfDoc.save();
  }

  public async download(filename: string): Promise<Blob> {
    const bytes = await this.build();
    const blob = new Blob([bytes as any], { type: "application/pdf" });
    triggerBrowserDownload(blob, filename);
    return blob;
  }
}
