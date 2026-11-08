import { POST } from "@/app/api/ai/memory/suggestions/route";
import { NextRequest } from "next/server";

describe("AI Memory Suggestions Stream API (/api/ai/memory/suggestions) (#4415)", () => {
  it("returns SSE response with event-stream content type and readable stream", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/ai/memory/suggestions",
      {
        method: "POST",
        body: JSON.stringify({
          prompt: "Find quiet spots",
          memories: ["Prefers standing desk", "Needs quiet zone"],
        }),
      },
    );

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    // Read the stream
    const text = await res.text();
    expect(text).toContain("data:");
    expect(text).toContain('"done":true');
  });
});
