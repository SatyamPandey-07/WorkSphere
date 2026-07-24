import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MessageList } from "@/components/chat/ChatMessages";

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
  BrainTerminal: () => <div data-testid="BrainTerminal" />
}));

jest.mock("../../components/chat/GenerativeUI", () => ({
  MessageRenderer: () => <div data-testid="MessageRenderer" />
}));

jest.mock("@/components/collections/AddToFolderModal", () => ({
  AddToFolderModal: () => <div data-testid="AddToFolderModal" />
}));

jest.mock("@/components/ui/EmptyState", () => ({
  EmptyState: () => <div data-testid="EmptyState" />
}));

jest.mock("@/components/ComparisonDrawer", () => ({
  ComparisonDrawer: () => <div data-testid="ComparisonDrawer" />
}));

jest.mock("@/components/ui/skeleton", () => ({
  ChatMessageSkeleton: () => <div data-testid="ChatMessageSkeleton" />
}));

jest.mock("@/components/ui/VenueGrid", () => ({
  VenueGrid: () => <div data-testid="VenueGrid" />,
  LayoutBoundary: ({ children }: any) => children,
  SubgridCell: ({ children }: any) => children,
}));

jest.mock("partysocket/react", () => ({
  __esModule: true,
  default: () => ({})
}));

jest.mock("@/lib/analytics", () => ({
  trackVenueInteraction: jest.fn()
}));

jest.mock("framer-motion", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const MockDiv = React.forwardRef(({ children, ...props }: any, ref: any) => <div ref={ref} {...props}>{children}</div>);
  MockDiv.displayName = "MockDiv";
  const MockSpan = React.forwardRef(({ children, ...props }: any, ref: any) => <span ref={ref} {...props}>{children}</span>);
  MockSpan.displayName = "MockSpan";
  const MockButton = React.forwardRef(({ children, ...props }: any, ref: any) => <button ref={ref} {...props}>{children}</button>);
  MockButton.displayName = "MockButton";
  const MockP = React.forwardRef(({ children, ...props }: any, ref: any) => <p ref={ref} {...props}>{children}</p>);
  MockP.displayName = "MockP";
  return {
    motion: {
      div: MockDiv,
      span: MockSpan,
      button: MockButton,
      p: MockP,
    },
    AnimatePresence: ({ children }: any) => children,
    LayoutGroup: ({ children }: any) => children,
  };
});

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => <img alt="optimized-mock" {...props} />,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

// Mock ResizeObserver
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("MessageList Gutter Bug Fix (#682)", () => {
  it("applies scrollbar-gutter stable inline style to avoid width jumping", () => {
    const { container } = render(
      <MessageList
        messages={[]}
        isLoading={false}
        error={null}
        expandedSteps={{}}
        favorites={new Set<string>()}
        messagesEndRef={React.createRef()}
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

    // Find the scrollable container (which has class overflow-y-auto)
    const scrollContainer = container.querySelector(".overflow-y-auto");
    expect(scrollContainer).toBeInTheDocument();
    expect(scrollContainer).toHaveStyle({ scrollbarGutter: "stable" });
  });
});
