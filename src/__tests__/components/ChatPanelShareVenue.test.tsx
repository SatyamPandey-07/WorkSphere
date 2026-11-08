import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ChatPanel,
  InteractiveVenuePreviewCard,
} from "@/components/chat/ChatPanel";
import type { Venue } from "@/types/venue";

// Mock sound utility
jest.mock("@/lib/chatSound", () => ({
  playChatMessageSound: jest.fn(),
  isChatSoundEnabled: jest.fn(() => false),
}));

// Mock recharts for VenueDetailDialog
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => <div />,
  Cell: () => <div />,
  ReferenceLine: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  LineChart: ({ children }: any) => <div>{children}</div>,
  Line: () => <div />,
  CartesianGrid: () => <div />,
}));

const mockTestVenues: Venue[] = [
  {
    id: "v-test-1",
    name: "Apex Cowork Space",
    category: "coworking_space",
    address: "100 Pine Street, Suite 400",
    rating: 4.85,
    imageUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c",
    lat: 37.792,
    lng: -122.4,
  },
  {
    id: "v-test-2",
    name: "Blue Bottle Coffee Workspace",
    category: "cafe",
    address: "315 Linden St",
    rating: 4.7,
    photoUrl: "https://images.unsplash.com/photo-1554118811-1e0d58224f24",
    lat: 37.776,
    lng: -122.424,
  },
];

describe("ChatPanel - Share Venue Card Attachment Feature", () => {
  beforeAll(() => {
    (global as any).EventSource = jest.fn().mockImplementation(() => ({
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
    }));
  });

  beforeEach(() => {
    // Default fetch mock
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/venues")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestVenues),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Attachment trigger and Venue Search popup", () => {
    it("renders the '+' attachment trigger in the message input toolbar", () => {
      render(
        <ChatPanel input="" onInputChange={jest.fn()} onSubmit={jest.fn()} />,
      );

      const trigger = screen.getByTestId("chat-attachment-trigger");
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-label", "Add attachment");
    });

    it("opens the attachment menu and shows 'Share Venue' action when '+' is clicked", () => {
      render(
        <ChatPanel input="" onInputChange={jest.fn()} onSubmit={jest.fn()} />,
      );

      const trigger = screen.getByTestId("chat-attachment-trigger");
      fireEvent.click(trigger);

      const menu = screen.getByTestId("chat-attachment-menu");
      expect(menu).toBeInTheDocument();

      const shareVenueBtn = screen.getByTestId("share-venue-action");
      expect(shareVenueBtn).toBeInTheDocument();
      expect(shareVenueBtn).toHaveTextContent("Share Venue");
    });

    it("opens venue search popup when 'Share Venue' is clicked and filters venues by name", async () => {
      render(
        <ChatPanel
          input=""
          venues={mockTestVenues}
          onInputChange={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );

      // Open attachment menu
      fireEvent.click(screen.getByTestId("chat-attachment-trigger"));
      // Click Share Venue
      fireEvent.click(screen.getByTestId("share-venue-action"));

      // Verify modal is open
      const modal = screen.getByTestId("venue-search-modal");
      expect(modal).toBeInTheDocument();
      expect(screen.getByText("Share a Venue")).toBeInTheDocument();

      // Verify search input
      const searchInput = screen.getByTestId("venue-search-input");
      expect(searchInput).toBeInTheDocument();

      // Check results listed
      expect(screen.getByText("Apex Cowork Space")).toBeInTheDocument();
      expect(
        screen.getByText("Blue Bottle Coffee Workspace"),
      ).toBeInTheDocument();

      // Filter by "Blue"
      fireEvent.change(searchInput, { target: { value: "Blue" } });
      expect(screen.queryByText("Apex Cowork Space")).not.toBeInTheDocument();
      expect(
        screen.getByText("Blue Bottle Coffee Workspace"),
      ).toBeInTheDocument();
    });

    it("attaches selected venue into the message draft toolbar and invokes onShareVenue", () => {
      const handleShareVenue = jest.fn();
      render(
        <ChatPanel
          input=""
          venues={mockTestVenues}
          onInputChange={jest.fn()}
          onSubmit={jest.fn()}
          onShareVenue={handleShareVenue}
        />,
      );

      // Open popup
      fireEvent.click(screen.getByTestId("chat-attachment-trigger"));
      fireEvent.click(screen.getByTestId("share-venue-action"));

      // Attach first venue
      const attachButtons = screen.getAllByTestId("select-venue-button");
      fireEvent.click(attachButtons[0]);

      // Verify callback called
      expect(handleShareVenue).toHaveBeenCalledWith(mockTestVenues[0]);

      // Modal closed
      expect(
        screen.queryByTestId("venue-search-modal"),
      ).not.toBeInTheDocument();

      // Attached venue chip rendered in composer toolbar
      const chip = screen.getByTestId("attached-venue-chip");
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveTextContent("Attached: Apex Cowork Space");

      // Can remove attached venue chip
      const removeBtn = screen.getByTestId("remove-attached-venue");
      fireEvent.click(removeBtn);
      expect(
        screen.queryByTestId("attached-venue-chip"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Interactive Venue Preview Card in message stream", () => {
    it("renders interactive venue preview card with image, name, rating, address inside message stream", () => {
      const messages = [
        {
          id: "m-1",
          role: "user",
          content: "Let's work here this afternoon!",
          venue: mockTestVenues[0],
        },
      ];

      render(<ChatPanel messages={messages} />);

      // Message content is present
      expect(
        screen.getByText("Let's work here this afternoon!"),
      ).toBeInTheDocument();

      // Interactive card is present
      const card = screen.getByTestId("interactive-venue-preview-card");
      expect(card).toBeInTheDocument();

      // Image
      const img = screen.getByTestId("venue-preview-image");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("alt", "Apex Cowork Space");

      // Name
      const name = screen.getByTestId("venue-preview-name");
      expect(name).toHaveTextContent("Apex Cowork Space");

      // Rating
      const rating = screen.getByTestId("venue-preview-rating");
      expect(rating).toBeInTheDocument();
      expect(rating).toHaveTextContent("4.8");

      // Address
      const address = screen.getByTestId("venue-preview-address");
      expect(address).toHaveTextContent("100 Pine Street, Suite 400");
    });

    it("opens venue detail dialog when interactive venue card is clicked", async () => {
      const handleVenueClick = jest.fn();
      const messages = [
        {
          id: "m-1",
          role: "user",
          content: "Check this venue out!",
          venue: mockTestVenues[0],
        },
      ];

      render(<ChatPanel messages={messages} onVenueClick={handleVenueClick} />);

      const card = screen.getByTestId("interactive-venue-preview-card");
      fireEvent.click(card);

      // Verify onVenueClick was called
      expect(handleVenueClick).toHaveBeenCalledWith(mockTestVenues[0]);

      // Verify VenueDetailDialog is displayed
      await waitFor(() => {
        expect(
          screen.getByRole("dialog", { name: /Apex Cowork Space details/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("InteractiveVenuePreviewCard standalone component", () => {
    it("renders image, name, rating, address, and handles click", () => {
      const handleClick = jest.fn();
      render(
        <InteractiveVenuePreviewCard
          venue={mockTestVenues[1]}
          onClick={handleClick}
        />,
      );

      expect(screen.getByTestId("venue-preview-name")).toHaveTextContent(
        "Blue Bottle Coffee Workspace",
      );
      expect(screen.getByTestId("venue-preview-address")).toHaveTextContent(
        "315 Linden St",
      );
      expect(screen.getByTestId("venue-preview-rating")).toHaveTextContent(
        "4.7",
      );

      const card = screen.getByTestId("interactive-venue-preview-card");
      fireEvent.click(card);
      expect(handleClick).toHaveBeenCalledWith(mockTestVenues[1]);
    });
  });
});
