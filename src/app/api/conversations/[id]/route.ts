import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

// GET /api/conversations/[id] - Get a conversation with messages
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    return Response.json({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((m: { id: string; role: string; content: string; agentName: string | null; createdAt: Date }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        agentName: m.agentName,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return Response.json(
      { error: "Failed to fetch conversation" },
      { status: 500 }
    );
  }
}

// DELETE /api/conversations/[id] - Delete a conversation
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify ownership
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId },
    });

    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Delete messages first (cascade)
    await prisma.message.deleteMany({
      where: { conversationId: id },
    });

    // Delete conversation
    await prisma.conversation.delete({
      where: { id },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return Response.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}

// PATCH /api/conversations/[id] - Update conversation title
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { title } = body;

    const conversation = await prisma.conversation.updateMany({
      where: { id, userId },
      data: { title },
    });

    if (conversation.count === 0) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    return Response.json({ success: true, title });
  } catch (error) {
    console.error("Update conversation error:", error);
    return Response.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}
