import { emailSchema, processMagicLinkRequest } from "@/lib/auth/emailService";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

describe("Email Normalization & Magic Link Auth", () => {
  const rawEmail = "Alex.Nomad@Domain.COM";
  const expectedEmail = "alex.nomad@domain.com";

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: expectedEmail },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: expectedEmail },
    });
    await prisma.$disconnect();
  });

  it("normalizes mixed-case and un-trimmed emails using Zod schema", () => {
    const parsed = emailSchema.parse("  Alex.Nomad@Domain.COM ");
    expect(parsed).toBe(expectedEmail);
  });

  it("rejects invalid email formats via Zod validation", () => {
    const result = emailSchema.safeParse("invalid-email-format");
    expect(result.success).toBe(false);
  });

  it("matches existing registered user regardless of input casing", async () => {
    await prisma.user.create({
      data: { email: expectedEmail },
    });

    const result = await processMagicLinkRequest(rawEmail);

    expect(result.success).toBe(true);
    expect(result.email).toBe(expectedEmail);

    const userCount = await prisma.user.count({
      where: { email: expectedEmail },
    });
    expect(userCount).toBe(1);
  });
});
