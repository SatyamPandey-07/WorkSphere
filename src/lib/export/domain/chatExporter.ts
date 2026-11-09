/**
 * Chat Conversation Exporter (Markdown and PDF).
 *
 * Implements markdown transcript formatting and PDF export for AI chat interactions.
 */

import { Message } from "@/components/chat/ChatMessages";
import {
  PdfDocumentBuilder,
  drawSafeText,
  safeText,
} from "../pdfBuilder";
import { rgb } from "pdf-lib";
import { wrapText } from "@/lib/pdf/generateBookingPdf";

export function formatChatHistoryMarkdown(messages?: Message[]): string {
  const safeMessages = Array.isArray(messages)
    ? messages.filter((m): m is Message => m != null)
    : [];

  const lines: string[] = [];
  lines.push("# WorkSphere AI Chat Conversation Export");
  lines.push(`*Exported on ${new Date().toLocaleString()}*\n`);
  lines.push("---\n");

  if (safeMessages.length === 0) {
    lines.push("*No conversation messages recorded.*");
    return lines.join("\n");
  }

  safeMessages.forEach((msg) => {
    const roleName = msg.role === "user" ? "User" : "WorkSphere AI";
    lines.push(`### ${roleName}`);
    const content = typeof msg.content === "string" ? msg.content : String(msg.content ?? "");
    lines.push(`${content}\n`);

    if (Array.isArray(msg.venues) && msg.venues.length > 0) {
      lines.push("**Recommended Venues:**");
      msg.venues.forEach((v) => {
        if (!v) return;
        const name = v.name || "Venue";
        const cat = v.category || "Venue";
        lines.push(`- **${name}** (${cat})`);
        if (v.address) lines.push(`  - Address: ${v.address}`);
        if (v.wifiSpeed) lines.push(`  - Wi-Fi: ${v.wifiSpeed} Mbps`);
        lines.push(`  - Power Outlets: ${v.hasOutlets ? "Yes" : "No"}`);
        if (v.noiseLevel) lines.push(`  - Noise Level: ${v.noiseLevel}`);
        if (
          typeof v.lat === "number" &&
          typeof v.lng === "number" &&
          Number.isFinite(v.lat) &&
          Number.isFinite(v.lng)
        ) {
          lines.push(
            `  - Map Location: https://maps.google.com/?q=${v.lat},${v.lng}`,
          );
        }
      });
      lines.push("");
    }
  });

  return lines.join("\n");
}

export async function generateChatPdfReport(
  messages?: Message[],
): Promise<Uint8Array> {
  const safeMessages = Array.isArray(messages)
    ? messages.filter((m): m is Message => m != null)
    : [];

  const builder = await PdfDocumentBuilder.create({
    accentColor: { r: 0.23, g: 0.51, b: 0.96 },
    margin: 40,
    title: "WorkSphere AI Chat Conversation Export",
  });

  const { boldFont, font } = builder;
  const availableWidth = builder.pageWidth - builder.margin * 2;

  // Header Title
  builder.drawHeading(
    "WorkSphere AI Chat Conversation Export",
    `Exported on ${new Date().toLocaleDateString()}`,
    { titleSize: 16, color: rgb(0.1, 0.1, 0.1) },
  );

  builder.drawDivider();

  if (safeMessages.length === 0) {
    builder.ensureSpace(50);
    builder.drawText("No conversation messages recorded.", {
      size: 10,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    builder.addPageNumbers();
    return await builder.build();
  }

  for (const msg of safeMessages) {
    builder.ensureSpace(40);

    const isUser = msg.role === "user";
    const roleText = isUser ? "User" : "WorkSphere AI";
    const roleColor = isUser ? rgb(0.2, 0.4, 0.8) : rgb(0.1, 0.6, 0.3);

    builder.drawText(roleText, {
      size: 11,
      font: boldFont,
      color: roleColor,
      decrementY: 14,
    });

    const rawContent = typeof msg.content === "string" ? msg.content : String(msg.content ?? "");
    const cleanContent = safeText(rawContent);

    const fontSize = 9;
    const lineHeight = 13;
    const lines = wrapText(cleanContent, font, fontSize, availableWidth);

    if (lines.length === 0) {
      builder.ensureSpace(lineHeight);
      builder.drawText("(empty message)", {
        size: fontSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        decrementY: lineHeight + 6,
      });
    } else {
      for (const line of lines) {
        builder.ensureSpace(lineHeight);
        builder.drawText(line, {
          size: fontSize,
          font,
          color: rgb(0.2, 0.2, 0.2),
          decrementY: lineHeight,
        });
      }
      builder.currentY -= 6;
    }

    // Recommended venues attached to message
    if (Array.isArray(msg.venues) && msg.venues.length > 0) {
      builder.ensureSpace(25);
      builder.drawText("Recommended Venues:", {
        size: 9.5,
        font: boldFont,
        color: rgb(0.15, 0.25, 0.45),
        decrementY: 13,
      });

      for (const v of msg.venues) {
        if (!v) continue;
        builder.ensureSpace(28);
        const name = v.name || "Venue";
        const cat = (v.category || "Coworking").toUpperCase();
        builder.drawText(`• ${name} (${cat})`, {
          size: 9,
          font: boldFont,
          color: rgb(0.15, 0.15, 0.15),
          decrementY: 12,
        });

        const details: string[] = [];
        if (v.address) details.push(v.address);
        if (v.wifiSpeed) details.push(`${v.wifiSpeed} Mbps`);
        if (v.hasOutlets !== undefined) details.push(v.hasOutlets ? "Power Outlets" : "No Outlets");
        if (v.noiseLevel) details.push(`Noise: ${v.noiseLevel}`);

        if (details.length > 0) {
          const detailText = `   ${details.join("  ·  ")}`;
          const detailLines = wrapText(safeText(detailText), font, 8, availableWidth - 10);
          for (const dLine of detailLines) {
            builder.ensureSpace(11);
            builder.drawText(dLine, {
              size: 8,
              font,
              color: rgb(0.4, 0.45, 0.5),
              decrementY: 11,
            });
          }
        }
      }
      builder.currentY -= 6;
    }

    builder.currentY -= 6;
  }

  builder.addPageNumbers();
  return await builder.build();
}
