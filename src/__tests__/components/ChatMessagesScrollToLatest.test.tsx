import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MessageList, Message } from "@/components/chat/ChatMessages";

// Mock SpeechRecognition and SpeechSynthesis
jest.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    startListening: jest.fn(),
    stopListening: jest.fn(),
    resetTranscript: jest.fn(),
    hasSupport: false,
  }),
}));

jest.mock("@/hooks/useSpeechSynthesis", () => ({
  useSpeechSynthesis: () => ({
    speak: jest.fn(),
    cancel: jest.fn(),
    speaking: false,
    supported: false,
  }),
}));

jest.mock("../../components/chat/BrainTerminal", () => ({
  BrainTerminal: () => <div data-testid="BrainTerminal" />,
}));

jest.mock("../../components/chat/GenerativeUI", () => ({
  MessageRenderer: () => <div data-testid="MessageRenderer" />,
}));

jest.mock("@/components/collections/AddToFolderModal", () => ({
  AddToFolderModal: () => <div data-testid="AddToFolderModal" />,
}));

jest.mock("@/components/ui/EmptyState", () => ({
  EmptyState: () => <div data-testid="EmptyState" />,
}));

jest.mock("@/components/ComparisonDrawer", () => ({
  ComparisonDrawer: () => <div data-testid="ComparisonDrawer" />,
}));

jest.mock("@/components/ui/skeleton", () => ({
  ChatMessageSkeleton: () => <div data-testid="ChatMessageSkeleton" />,
}));

jest.mock("@/components/ui/VenueGrid", () => ({
  VenueGrid: () => <div data-testid="VenueGrid" />,
  LayoutBoundary: ({ children }: any) => children,
  SubgridCell: ({ children }: any) => children,
}));

jest.mock("partysocket/react", () => ({
  __esModule: true,
  default: () => ({}),
}));

jest.mock("@/lib/analytics", () => ({
  trackVenueInteraction: jest.fn(),
}));

jest.mock("framer-motion", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const MockDiv = React.forwardRef(({ children, ...props }: any, ref: any) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  ));
  MockDiv.displayName = "MockDiv";
  return {
    motion: {
      div: MockDiv,
      button: (props: any) => <button {...props} />,
    },
    AnimatePresence: ({ children }: any) => children,
    LayoutGroup: ({ children }: any) => children,
  };
});

jest.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: any) => <img alt="optimized-mock" {...props} />,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("MessageList 'Scroll to Latest' Button", () => {
  const sampleMessages: Message[] = [
    {
      id: "msg-1",
      role: "user",
      content: "Hello",
      timestamp: new Date(),
    },
    {
      id: "msg-2",
      role: "assistant",
      content: "Hi, how can I help you?",
      timestamp: new Date(),
    },
  ];

  it("does not show 'Scroll to Latest' button when already at the bottom", () => {
    const endRef = React.createRef<HTMLDivElement>();
    const { container } = render(
      <MessageList
        messages={sampleMessages}
        isLoading={false}
        error={null}
        expandedSteps={{}}
        favorites={new Set<string>()}
        messagesEndRef={endRef}
        onToggleSteps={jest.fn()}
        onGetDirections={jest.fn()}
        onToggleFavorite={jest.fn()}
        onRateVenue={jest.fn()}
        onOpenDetails={jest.fn()}
        onBook={jest.fn()}
        onSuggestionClick={jest.fn()}
        initialSuggestions={[]}
      />
    );

    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    expect(scrollContainer).toBeInTheDocument();

    // Default distance is 0 (< 200)
    expect(screen.queryByRole("button", { name: /scroll to latest message/i })).not.toBeInTheDocument();
  });

  it("shows 'Scroll to Latest' button when scrolled away from bottom and hides when scrolled back", () => {
    const endRef = React.createRef<HTMLDivElement>();
    const { container } = render(
      <MessageList
        messages={sampleMessages}
        isLoading={false}
        error={null}
        expandedSteps={{}}
        favorites={new Set<string>()}
        messagesEndRef={endRef}
        onToggleSteps={jest.fn()}
        onGetDirections={jest.fn()}
        onToggleFavorite={jest.fn()}
        onRateVenue={jest.fn()}
        onOpenDetails={jest.fn()}
        onBook={jest.fn()}
        onSuggestionClick={jest.fn()}
        initialSuggestions={[]}
      />
    );

    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;

    // Simulate scrolling upward away from bottom
    // scrollHeight = 1000, clientHeight = 400, scrollTop = 100 -> distance = 500 >= 200
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, "scrollTop", { value: 100, configurable: true, writable: true });

    fireEvent.scroll(scrollContainer);

    const button = screen.getByRole("button", { name: /scroll to latest message/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "Scroll to latest");

    // Now simulate scrolling back to bottom: scrollTop = 550 -> distance = 50 < 200
    scrollContainer.scrollTop = 550;
    fireEvent.scroll(scrollContainer);

    expect(screen.queryByRole("button", { name: /scroll to latest message/i })).not.toBeInTheDocument();
  });

  it("smoothly scrolls to messagesEndRef when the button is clicked", () => {
    const scrollIntoViewMock = jest.fn();
    window.HTMLDivElement.prototype.scrollIntoView = scrollIntoViewMock;
    const endRef = React.createRef<HTMLDivElement>();

    const { container } = render(
      <MessageList
        messages={sampleMessages}
        isLoading={false}
        error={null}
        expandedSteps={{}}
        favorites={new Set<string>()}
        messagesEndRef={endRef}
        onToggleSteps={jest.fn()}
        onGetDirections={jest.fn()}
        onToggleFavorite={jest.fn()}
        onRateVenue={jest.fn()}
        onOpenDetails={jest.fn()}
        onBook={jest.fn()}
        onSuggestionClick={jest.fn()}
        initialSuggestions={[]}
      />
    );

    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, "scrollTop", { value: 100, configurable: true, writable: true });

    fireEvent.scroll(scrollContainer);

    const button = screen.getByRole("button", { name: /scroll to latest message/i });
    fireEvent.click(button);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("does not show button when there are no messages", () => {
    const endRef = React.createRef<HTMLDivElement>();
    const { container } = render(
      <MessageList
        messages={[]}
        isLoading={false}
        error={null}
        expandedSteps={{}}
        favorites={new Set<string>()}
        messagesEndRef={endRef}
        onToggleSteps={jest.fn()}
        onGetDirections={jest.fn()}
        onToggleFavorite={jest.fn()}
        onRateVenue={jest.fn()}
        onOpenDetails={jest.fn()}
        onBook={jest.fn()}
        onSuggestionClick={jest.fn()}
        initialSuggestions={[]}
      />
    );

    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, "scrollTop", { value: 100, configurable: true, writable: true });

    fireEvent.scroll(scrollContainer);

    expect(screen.queryByRole("button", { name: /scroll to latest message/i })).not.toBeInTheDocument();
  });
});
