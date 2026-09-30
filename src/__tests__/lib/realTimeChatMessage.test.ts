/**
 * Tests for real-time chat message handling in workspace rooms.
 */

type MessageType = "text" | "image" | "file" | "system";

interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  type: MessageType;
  content: string;
  sentAt: number;
  editedAt?: number;
  deletedAt?: number;
}

function isVisible(msg: ChatMessage): boolean {
  return !msg.deletedAt;
}

function isEdited(msg: ChatMessage): boolean {
  return msg.editedAt !== undefined;
}

function editMessage(msg: ChatMessage, newContent: string, nowMs: number): ChatMessage {
  if (msg.deletedAt) throw new Error("Cannot edit deleted message");
  return { ...msg, content: newContent, editedAt: nowMs };
}

function deleteMessage(msg: ChatMessage, nowMs: number): ChatMessage {
  return { ...msg, deletedAt: nowMs };
}

function roomMessages(
  messages: ChatMessage[],
  roomId: string,
  includeDeleted = false
): ChatMessage[] {
  return messages
    .filter((m) => m.roomId === roomId && (includeDeleted || isVisible(m)))
    .sort((a, b) => a.sentAt - b.sentAt);
}

const NOW = 1_700_000_000_000;
const MSGS: ChatMessage[] = [
  { id: "m1", roomId: "r1", senderId: "u1", type: "text",   content: "Hello!", sentAt: NOW - 3000 },
  { id: "m2", roomId: "r1", senderId: "u2", type: "text",   content: "Hi!",    sentAt: NOW - 2000, editedAt: NOW - 1000 },
  { id: "m3", roomId: "r1", senderId: "u1", type: "image",  content: "img.png",sentAt: NOW - 1000, deletedAt: NOW - 500 },
  { id: "m4", roomId: "r2", senderId: "u3", type: "system", content: "Joined", sentAt: NOW - 100  },
];

describe("Real-time chat messages", () => {
  it("isVisible: non-deleted → true", () => {
    expect(isVisible(MSGS[0])).toBe(true);
  });

  it("isVisible: deleted → false", () => {
    expect(isVisible(MSGS[2])).toBe(false);
  });

  it("isEdited: edited message → true", () => {
    expect(isEdited(MSGS[1])).toBe(true);
  });

  it("isEdited: unedited → false", () => {
    expect(isEdited(MSGS[0])).toBe(false);
  });

  it("editMessage updates content and editedAt", () => {
    const edited = editMessage(MSGS[0], "Updated!", NOW);
    expect(edited.content).toBe("Updated!");
    expect(edited.editedAt).toBe(NOW);
  });

  it("editMessage throws for deleted message", () => {
    expect(() => editMessage(MSGS[2], "X", NOW)).toThrow();
  });

  it("deleteMessage sets deletedAt", () => {
    const deleted = deleteMessage(MSGS[0], NOW);
    expect(deleted.deletedAt).toBe(NOW);
  });

  it("roomMessages: visible only by default", () => {
    const visible = roomMessages(MSGS, "r1");
    expect(visible.every(isVisible)).toBe(true);
    expect(visible).toHaveLength(2);
  });

  it("roomMessages with includeDeleted: 3 messages", () => {
    expect(roomMessages(MSGS, "r1", true)).toHaveLength(3);
  });

  it("roomMessages sorted by sentAt ascending", () => {
    const msgs = roomMessages(MSGS, "r1");
    expect(msgs[0].sentAt).toBeLessThan(msgs[1].sentAt);
  });
});
