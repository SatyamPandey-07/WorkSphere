import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const name = searchParams.get("name") ?? "Cafe Coffee Day";

    const API_KEY = process.env.PEXELS_API_KEY;

    if (!API_KEY) {
        return Response.json({ error: "PEXELS_API_KEY is NOT set on this server" });
    }

    const maskedKey = `${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`;

    try {
        const url = new URL("https://api.pexels.com/v1/search");
        url.searchParams.set("query", name);
        url.searchParams.set("per_page", "1");
        url.searchParams.set("orientation", "landscape");

        const res = await fetch(url.toString(), {
            headers: { Authorization: API_KEY },
        });

        const text = await res.text();
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = text; }

        const photos = (body as { photos?: Array<{ src: { large2x: string } }> }).photos;
        const photoUrl = photos?.[0]?.src?.large2x ?? null;

        return Response.json({ keyPresent: true, maskedKey, status: res.status, photoUrl, response: body });
    } catch (err) {
        return Response.json({ keyPresent: true, maskedKey, error: String(err) });
    }
}