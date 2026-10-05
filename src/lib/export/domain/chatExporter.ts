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

export function formatChatHistoryMarkdown(messages: Message[]): string {
  const lines: string[] = [];
  lines.push("# WorkSphere AI Chat Conversation Export");
  lines.push(`*Exported on ${new Date().toLocaleString()}*\n`);
  lines.push("---\n");

  messages.forEach((msg) => {
    const roleName = msg.role === "user" ? "User" : "WorkSphere AI";
    lines.push(`### ${roleName}`);
    lines.push(`${msg.content}\n`);

    if (msg.venues && msg.venues.length > 0) {
      lines.push("**Recommended Venues:**");
      msg.venues.forEach((v) => {
        lines.push(`- **${v.name}** (${v.category || "Venue"})`);
        if (v.address) lines.push(`  - Address: ${v.address}`);
        if (v.wifiSpeed) lines.push(`  - Wi-Fi: ${v.wifiSpeed} Mbps`);
        lines.push(`  - Power Outlets: ${v.hasOutlets ? "Yes" : "No"}`);
        if (v.noiseLevel) lines.push(`  - Noise Level: ${v.noiseLevel}`);
        lines.push(
          `  - Map Location: https://maps.google.com/?q=${v.lat},${v.lng}`,
        );
      });
      lines.push("");
    }
  });

  return lines.join("\n");
}

export async function generateChatPdfReport(
  messages: Message[],
): Promise<Uint8Array> {
  const builder = await PdfDocumentBuilder.create({
    accentColor: { r: 0.23, g: 0.51, b: 0.96 },
    margin: 40,
    title: "WorkSphere AI Chat Conversation Export",
  });

  const { boldFont, font } = builder;

  // Header Title
  builder.drawHeading(
    "WorkSphere AI Chat Conversation Export",
    `Exported on ${new Date().toLocaleDateString()}`,
    { titleSize: 16, color: rgb(0.1, 0.1, 0.1) },
  );

  builder.drawDivider();

  for (const msg of messages) {
    builder.ensureSpace(50);

    const isUser = msg.role === "user";
    const roleText = isUser ? "User" : "WorkSphere AI";
    const roleColor = isUser ? rgb(0.2, 0.4, 0.8) : rgb(0.1, 0.6, 0.3);

    builder.drawText(roleText, {
      size: 11,
      font: boldFont,
      color: roleColor,
      decrementY: 14,
    });

    const cleanContent = safeText(msg.content);
    builder.drawText(cleanContent.slice(0, 200), {
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
      decrementY: 16,
    });
  }

  builder.addPageNumbers();
  return await builder.build();
}
