import { render, screen, renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import {
  ChatPanel,
  generateClientMessageId,
  createOptimisticMessage,
  deduplicateMessages,
  reconcileMessageState,
  useDeduplicatedMessages,
  useChatReconnectDeduplication,
  ChatMessageLike,
} from "@/components/chat/ChatPanel";

describe("Chat Panel Fast Reconnect & Message Deduplication (#4126)", () => {
  describe("generateClientMessageId", () => {
    it("generates deterministic client message IDs with role, snippet, and timestamp", () => {
      const id1 = generateClientMessageId("Hello world", "user", 1700000000000);
      const id2 = generateClientMessageId("Hello world", "user", 1700000000000);
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^cmid_user_/);
    });

    it("differentiates different roles and content", () => {
      const idUser = generateClientMessageId("Hello", "user", 1700000000000);
      const idAssistant = generateClientMessageId("Hello", "assistant", 1700000000000);
      expect(idUser).not.toBe(idAssistant);
    });
  });

  describe("createOptimisticMessage", () => {
    it("creates a pending optimistic message with clientMessageId", () => {
      const msg = createOptimisticMessage("Optimistic text", "user");
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Optimistic text");
      expect(msg.status).toBe("pending");
      expect(msg.clientMessageId).toBeDefined();
      expect(msg.clientMessageId).toMatch(/^cmid_user_/);
    });
  });

  describe("deduplicateMessages", () => {
    it("deduplicates messages with identical clientMessageId", () => {
      const clientMsgId = "cmid_user_123456";
      const existing: ChatMessageLike[] = [
        {
          clientMessageId: clientMsgId,
          role: "user",
          content: "Hello server",
          status: "pending",
        },
      ];
      const incoming: ChatMessageLike[] = [
        {
          clientMessageId: clientMsgId,
          id: "srv-msg-999",
          role: "user",
          content: "Hello server",
          status: "sent",
        },
      ];

      const { deduplicated, reconciledCount } = deduplicateMessages(existing, incoming);
      expect(deduplicated.length).toBe(1);
      expect(reconciledCount).toBe(1);
      expect(deduplicated[0].id).toBe("srv-msg-999");
      expect(deduplicated[0].status).toBe("sent");
    });

    it("reconciles incoming server broadcast by server ID", () => {
      const existing: ChatMessageLike[] = [
        {
          id: "msg-101",
          role: "assistant",
          content: "Existing reply",
        },
      ];
      const incoming: ChatMessageLike[] = [
        {
          id: "msg-101",
          role: "assistant",
          content: "Existing reply updated",
          status: "sent",
        },
      ];

      const { deduplicated, reconciledCount } = deduplicateMessages(existing, incoming);
      expect(deduplicated.length).toBe(1);
      expect(reconciledCount).toBe(1);
      expect(deduplicated[0].content).toBe("Existing reply updated");
    });

    it("fallback reconciles pending optimistic messages by role and content signature", () => {
      const existing: ChatMessageLike[] = [
        {
          role: "user",
          content: "Pending question",
          status: "pending",
        },
      ];
      const incoming: ChatMessageLike[] = [
        {
          id: "srv-777",
          clientMessageId: "cmid_user_777",
          role: "user",
          content: "Pending question",
          status: "sent",
        },
      ];

      const { deduplicated, reconciledCount } = deduplicateMessages(existing, incoming);
      expect(deduplicated.length).toBe(1);
      expect(reconciledCount).toBe(1);
      expect(deduplicated[0].id).toBe("srv-777");
    });

    it("appends new non-duplicate incoming messages", () => {
      const existing: ChatMessageLike[] = [
        { id: "1", role: "user", content: "Msg 1" },
      ];
      const incoming: ChatMessageLike[] = [
        { id: "2", role: "assistant", content: "Msg 2" },
      ];

      const { deduplicated } = deduplicateMessages(existing, incoming);
      expect(deduplicated.length).toBe(2);
      expect(deduplicated[1].id).toBe("2");
    });
  });

  describe("reconcileMessageState", () => {
    it("handles single message object input cleanly", () => {
      const current: ChatMessageLike[] = [
        { clientMessageId: "c1", role: "user", content: "Test", status: "pending" },
      ];
      const incoming: ChatMessageLike = {
        clientMessageId: "c1",
        id: "srv-1",
        role: "user",
        content: "Test",
        status: "sent",
      };

      const result = reconcileMessageState(current, incoming);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("srv-1");
    });
  });

  describe("useDeduplicatedMessages Hook", () => {
    it("manages optimistic message addition and server confirmation", () => {
      const { result } = renderHook(() => useDeduplicatedMessages());

      let optMsg: ChatMessageLike;
      act(() => {
        optMsg = result.current.addOptimisticMessage({
          role: "user",
          content: "Optimistic message test",
        });
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.pendingCount).toBe(1);

      act(() => {
        result.current.confirmMessage(optMsg!.clientMessageId!, "server-id-123");
      });

      expect(result.current.messages[0].id).toBe("server-id-123");
      expect(result.current.messages[0].status).toBe("sent");
      expect(result.current.pendingCount).toBe(0);
    });

    it("prevents replaying local messages on fast reconnect sync", () => {
      const { result } = renderHook(() =>
        useDeduplicatedMessages([
          { clientMessageId: "cmid_1", role: "user", content: "Hi", status: "pending" },
        ])
      );

      act(() => {
        result.current.reconcileIncoming(
          [
            { clientMessageId: "cmid_1", id: "s1", role: "user", content: "Hi", status: "sent" },
            { id: "s2", role: "assistant", content: "Hello back!", status: "sent" },
          ],
          true
        );
      });

      expect(result.current.messages.length).toBe(2);
      expect(result.current.messages[0].id).toBe("s1");
      expect(result.current.messages[1].id).toBe("s2");
    });
  });

  describe("useChatReconnectDeduplication Hook", () => {
    it("tracks reconnect lifecycle and synchronizes server messages without duplicating local pending messages", () => {
      const localMessages: ChatMessageLike[] = [
        { clientMessageId: "cmid_recon_1", role: "user", content: "Fast reconnect msg", status: "pending" },
      ];

      const { result } = renderHook(() =>
        useChatReconnectDeduplication(localMessages)
      );

      act(() => {
        result.current.handleBeforeReconnect();
      });

      expect(result.current.isReconnecting).toBe(true);

      let synced: ChatMessageLike[] = [];
      act(() => {
        synced = result.current.handleReconnectSync([
          {
            clientMessageId: "cmid_recon_1",
            id: "server-confirmed-id",
            role: "user",
            content: "Fast reconnect msg",
            status: "sent",
          },
          { id: "server-msg-2", role: "assistant", content: "Reconnected successfully!" },
        ]);
      });

      expect(result.current.isReconnecting).toBe(false);
      expect(synced.length).toBe(2);
      expect(synced[0].id).toBe("server-confirmed-id");
    });
  });

  describe("ChatPanel Component Integration", () => {
    it("renders clientMessageId attributes and deduplicates prop messages", () => {
      const messages: ChatMessageLike[] = [
        { clientMessageId: "cmid_ui_1", role: "user", content: "Duplicate UI message" },
        { clientMessageId: "cmid_ui_1", role: "user", content: "Duplicate UI message" },
      ];

      render(<ChatPanel messages={messages} />);

      const renderedMessages = screen.getAllByText("Duplicate UI message");
      expect(renderedMessages.length).toBe(1);
    });

    it("displays reconnecting banner when isReconnecting is true", () => {
      render(<ChatPanel isReconnecting={true} messages={[]} />);
      expect(screen.getByTestId("reconnecting-banner")).toBeInTheDocument();
      expect(
        screen.getByText("Reconnecting to chat room... Synchronizing messages.")
      ).toBeInTheDocument();
    });

    it("displays sending... indicator for pending optimistic messages", () => {
      const messages: ChatMessageLike[] = [
        {
          clientMessageId: "cmid_pending_1",
          role: "user",
          content: "Pending user request",
          status: "pending",
        },
      ];

      render(<ChatPanel messages={messages} />);
      expect(screen.getByTestId("pending-indicator")).toBeInTheDocument();
      expect(screen.getByText("(sending...)")).toBeInTheDocument();
    });
  });
});
