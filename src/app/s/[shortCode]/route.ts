import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shortCode: string }> },
) {
  try {
    const { shortCode } = await params;
    const normalizedCode = shortCode.trim().toLowerCase();

    // Find the short link
    const shortLink = await prisma.shortLink.findUnique({
      where: { shortCode: normalizedCode },
      include: {
        folder: true,
      },
    });

    // Custom helper to return the styled error page
    const renderErrorPage = () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Expired or Not Found - WorkSphere</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      background-color: #09090b;
      color: #fafafa;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
  </style>
</head>
<body class="flex min-h-screen flex-col items-center justify-center p-4 bg-zinc-950">
  <div class="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/50 p-8 text-center shadow-2xl backdrop-blur-md">
    <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-8 w-8">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z" />
      </svg>
    </div>
    <h1 class="text-2xl font-extrabold text-white">Link Expired or Not Found</h1>
    <p class="mt-3 text-sm text-zinc-400">
      This short link has either expired, been deleted by the owner, or never existed.
    </p>
    <div class="mt-8">
      <a href="/" class="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-500 active:scale-95">
        Go to WorkSphere
      </a>
    </div>
  </div>
</body>
</html>`;
      return new NextResponse(html, {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });
    };

    if (!shortLink || !shortLink.folder) {
      return renderErrorPage();
    }

    // Check expiration
    if (shortLink.expiresAt && new Date() > shortLink.expiresAt) {
      return renderErrorPage();
    }

    // Redirect to public folder page
    const inviteToken = shortLink.folder.inviteToken;
    if (!inviteToken) {
      return renderErrorPage();
    }

    const redirectUrl = new URL(
      `/collections/public/${inviteToken}?s=${normalizedCode}`,
      request.url,
    );
    return NextResponse.redirect(redirectUrl, 307);
  } catch (error) {
    console.error("GET /s/[shortCode] error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
