import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const emailSchema = z
  .string()
  .trim()
  .email({ message: "Invalid email address format" })
  .transform((val) => val.toLowerCase());

export interface MagicLinkResult {
  success: boolean;
  email?: string;
  token?: string;
  error?: string;
}

export async function processMagicLinkRequest(
  rawEmail: string,
): Promise<MagicLinkResult> {
  const parseResult = emailSchema.safeParse(rawEmail);

  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.errors[0]?.message || "Invalid email format",
    };
  }

  const normalizedEmail = parseResult.data;

  let user = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
    },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
      },
    });
  }

  const token = `magic_${Math.random().toString(36).substring(2)}${Date.now()}`;

  return {
    success: true,
    email: normalizedEmail,
    token,
  };
}
