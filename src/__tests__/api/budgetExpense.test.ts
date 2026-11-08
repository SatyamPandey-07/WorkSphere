import { POST } from "@/app/api/budget/expense/route";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({ userId: "test-user-123" }),
}));

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/budget/expense", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/budget/expense", () => {
  it("rejects negative expense amount with 400 Bad Request", async () => {
    const req = makePostRequest({
      venueName: "WeWork Downtown Hub",
      department: "Engineering",
      amount: -50,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error).toContain("Amount must be greater than zero");
  });

  it("rejects zero expense amount with 400 Bad Request", async () => {
    const req = makePostRequest({
      venueName: "WeWork Downtown Hub",
      department: "Engineering",
      amount: 0,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error).toContain("Amount must be greater than zero");
  });

  it("rejects non-numeric expense amount with 400 Bad Request", async () => {
    const req = makePostRequest({
      venueName: "WeWork Downtown Hub",
      department: "Engineering",
      amount: "invalid-amount",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("rejects missing venueName with 400 Bad Request", async () => {
    const req = makePostRequest({
      department: "Engineering",
      amount: 45,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error).toContain("Valid venue name is required");
  });

  it("accepts strictly positive expense amounts and updates budget summary", async () => {
    const req = makePostRequest({
      venueName: "Mindspace Mezzanine",
      category: "Hot Desk",
      department: "Engineering",
      costCenter: "CC-101",
      amount: 75.5,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.expense).toBeDefined();
    expect(data.expense.amount).toBe(75.5);
    expect(data.summary).toBeDefined();
  });
});
