import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { Message } from "@/components/chat/ChatMessages";

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
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { height } = page.getSize();
  let y = height - 50;

  page.drawText("WorkSphere AI Chat Conversation Export", {
    x: 40,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 20;

  page.drawText(`Exported on: ${new Date().toLocaleDateString()}`, {
    x: 40,
    y,
    size: 10,
    font: fontReg,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 30;

  for (const msg of messages) {
    if (y < 80) {
      page = pdfDoc.addPage([595, 842]);
      y = 790;
    }

    const roleName = msg.role === "user" ? "User:" : "WorkSphere AI:";
    page.drawText(roleName, {
      x: 40,
      y,
      size: 12,
      font: fontBold,
      color: msg.role === "user" ? rgb(0.2, 0.4, 0.8) : rgb(0.1, 0.6, 0.3),
    });
    y -= 18;

    const contentLines = (msg.content || "").split("\n");
    for (const line of contentLines) {
      if (y < 80) {
        page = pdfDoc.addPage([595, 842]);
        y = 790;
      }
      const safeLine = line.slice(0, 85);
      page.drawText(safeLine, {
        x: 50,
        y,
        size: 10,
        font: fontReg,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 15;
    }

    if (msg.venues && msg.venues.length > 0) {
      y -= 5;
      if (y < 80) {
        page = pdfDoc.addPage([595, 842]);
        y = 790;
      }

      page.drawText("Recommended Venues:", {
        x: 50,
        y,
        size: 10,
        font: fontBold,
        color: rgb(0.3, 0.3, 0.3),
      });
      y -= 15;

      for (const v of msg.venues) {
        if (y < 80) {
          page = pdfDoc.addPage([595, 842]);
          y = 790;
        }
        const venueText = `• ${v.name} (${v.category || "Venue"}) - ${v.address || "No address"}`;
        page.drawText(venueText.slice(0, 80), {
          x: 60,
          y,
          size: 9,
          font: fontReg,
          color: rgb(0.3, 0.3, 0.3),
        });
        y -= 14;
      }
    }
    y -= 15;
  }

  return await pdfDoc.save();
}
