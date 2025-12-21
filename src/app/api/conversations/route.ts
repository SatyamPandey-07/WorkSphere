import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

// GET /api/conversations - Get user's conversations
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return Response.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title || "Work Space Search",
        lastMessage: c.messages[0]?.content?.slice(0, 100) || "",
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
      })),
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    return Response.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}

// POST /api/conversations - Create a new conversation
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure user exists in database
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });

    const body = await req.json();
    const { title } = body;

    const conversation = await prisma.conversation.create({
      data: {
        userId,
        title: title || "Work Space Search",
      },
    });

    return Response.json({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
    });
  } catch (error) {
    console.error("Create conversation error:", error);
    return Response.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
