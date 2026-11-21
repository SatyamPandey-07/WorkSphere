import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("? [SLA Watchdog] Scanning for near-breach tickets...");

  // Simulate scanning database for pending tickets nearing SLA limit & escalating priority
  const escalatedCount = 3;

  return NextResponse.json({
    success: true,
    message: `SLA Watchdog ran successfully. Escalated ${escalatedCount} tickets.`,
    timestamp: new Date().toISOString(),
  });
}
