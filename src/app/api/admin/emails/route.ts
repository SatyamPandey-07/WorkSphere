import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import {
  getAdminEmailMetrics,
  parseEmailRange,
} from "@/lib/adminEmails";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const range = parseEmailRange(request.nextUrl.searchParams.get("range"));
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(request.nextUrl.searchParams.get("pageSize") ?? "20", 10)));
    const search = request.nextUrl.searchParams.get("search") || undefined;

    const metrics = await getAdminEmailMetrics(range, page, pageSize, search);

    return NextResponse.json(metrics, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("[Admin Emails API]", error);
    return NextResponse.json({ error: "Failed to load email metrics" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "sendTest") {
      const { recipient } = body;
      if (!recipient || typeof recipient !== "string") {
        return NextResponse.json({ error: "Recipient email is required" }, { status: 400 });
      }

      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;

      if (!user || !pass) {
        return NextResponse.json({ error: "SMTP not configured" }, { status: 400 });
      }

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: process.env.SMTP_PORT !== "587",
        auth: { user, pass },
      });

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || `"WorkSphere Admin" <${user}>`,
          to: recipient,
          subject: "WorkSphere SMTP Test Email",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#18181b">
              <h2 style="margin:0 0 12px">SMTP Test Successful</h2>
              <p>This is a test email from the WorkSphere admin panel.</p>
              <p style="color:#71717a;font-size:13px;margin-top:24px">Sent at ${new Date().toISOString()}</p>
            </div>
          `,
        });

        await prisma.emailLog.create({
          data: {
            type: "TEST",
            recipient,
            subject: "WorkSphere SMTP Test Email",
            status: "SENT",
            metadata: { sentBy: admin.id },
          },
        });

        return NextResponse.json({ success: true, message: "Test email sent successfully" });
      } catch (err: any) {
        await prisma.emailLog.create({
          data: {
            type: "TEST",
            recipient,
            subject: "WorkSphere SMTP Test Email",
            status: "FAILED",
            error: err?.message || "Unknown error",
            metadata: { sentBy: admin.id },
          },
        });

        return NextResponse.json({ success: false, error: err?.message || "Failed to send test email" }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Admin Emails API POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
