import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import "@testing-library/jest-dom";

jest.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
}));

// ChatHeader reads the currency selector from context; no provider is needed here.
jest.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ currency: "USD", setCurrency: jest.fn() }),
}));
jest.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

function FiltersHarness({ withClearAll = false }: { withClearAll?: boolean }) {
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <ChatHeader
      onOpenVenueSubmission={() => {}}
      onLocationChange={() => {}}
      filters={filters}
      showFilters={showFilters}
      setShowFilters={setShowFilters}
      onToggleFilter={(key) =>
        setFilters((prev) => {
          const next = { ...prev };
          if (next[key]) delete next[key];
          else next[key] = true;
          return next;
        })
      }
      onSetFilter={(key, value) =>
        setFilters((prev) => {
          const next = { ...prev };
          if (value === "none" || value === "all") delete next[key];
          else next[key] = value;
          return next;
        })
      }
      onClearFilters={withClearAll ? () => setFilters({}) : undefined}
      showHistory={showHistory}
      setShowHistory={setShowHistory}
      onNewChat={() => {}}
      conversations={[]}
      onLoadConversation={() => {}}
      onDeleteConversation={() => {}}
      onRenameConversation={() => {}}
      onShowBookings={() => {}}
    />
  );
}

describe("ChatHeader filters", () => {
  it("keeps the filters panel open when amenity checkboxes are clicked", () => {
    render(<FiltersHarness />);

    fireEvent.click(screen.getByTitle("Filters"));
    expect(screen.getByText("Amenity Toggles")).toBeInTheDocument();

    const outlets = screen.getByLabelText("Has Outlets") as HTMLInputElement;
    fireEvent.click(outlets);

    expect(outlets).toBeChecked();
    expect(screen.getByText("Amenity Toggles")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("High-Speed WiFi"));
    expect(screen.getByLabelText("High-Speed WiFi")).toBeChecked();
    expect(screen.getByText("Amenity Toggles")).toBeInTheDocument();
  });
});

describe("ChatHeader clear-all filters (#7610)", () => {
  const openPanel = () => fireEvent.click(screen.getByTitle("Filters"));
  const clearAll = () => screen.queryByTestId("clear-all-filters-btn");

  it("shows Clear all only when two or more filters are active", () => {
    render(<FiltersHarness withClearAll />);
    openPanel();
    expect(clearAll()).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("High-Speed WiFi"));
    expect(clearAll()).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("No Background Music"));
    expect(clearAll()).toBeInTheDocument();
    expect(clearAll()).toHaveAccessibleName("Clear all 2 filters");
    expect(screen.getByText("2 filters active")).toBeInTheDocument();
  });

  it("counts segment filters such as Wi-Fi speed band", () => {
    render(<FiltersHarness withClearAll />);
    openPanel();

    fireEvent.click(screen.getByLabelText("Low Noise"));
    fireEvent.click(screen.getByText("Fast (>50 Mbps)"));

    expect(clearAll()).toHaveAccessibleName("Clear all 2 filters");
  });

  it("resets every filter, hides itself, keeps the panel open and returns focus to the Filters button", () => {
    render(<FiltersHarness withClearAll />);
    openPanel();
    fireEvent.click(screen.getByLabelText("High-Speed WiFi"));
    fireEvent.click(screen.getByLabelText("Low Noise"));
    fireEvent.click(screen.getByText("Lo-Fi / Chill Beats"));

    clearAll()!.focus();
    fireEvent.click(clearAll()!);

    expect(screen.getByLabelText("High-Speed WiFi")).not.toBeChecked();
    expect(screen.getByLabelText("Low Noise")).not.toBeChecked();
    expect(screen.getByText("Any Style")).toHaveClass("bg-orange-600");
    expect(clearAll()).not.toBeInTheDocument();
    expect(screen.getByText("Amenity Toggles")).toBeInTheDocument();
    expect(screen.getByTitle("Filters")).toHaveFocus();
  });

  it("is a keyboard-focusable native button", () => {
    render(<FiltersHarness withClearAll />);
    openPanel();
    fireEvent.click(screen.getByLabelText("High-Speed WiFi"));
    fireEvent.click(screen.getByLabelText("Has Outlets"));

    expect(clearAll()!.tagName).toBe("BUTTON");
    expect(clearAll()).toHaveAttribute("type", "button");
    clearAll()!.focus();
    expect(clearAll()).toHaveFocus();
  });

  it("does not count distanceRadius, which is set outside the panel", () => {
    render(
      <ChatHeader
        onOpenVenueSubmission={() => {}}
        onLocationChange={() => {}}
        filters={{ wifi: true, distanceRadius: 5 }}
        showFilters
        setShowFilters={() => {}}
        onToggleFilter={() => {}}
        onClearFilters={() => {}}
        showHistory={false}
        setShowHistory={() => {}}
        onNewChat={() => {}}
        conversations={[]}
        onLoadConversation={() => {}}
        onDeleteConversation={() => {}}
        onRenameConversation={() => {}}
        onShowBookings={() => {}}
      />,
    );

    expect(clearAll()).not.toBeInTheDocument();
  });

  it("is not rendered when no onClearFilters handler is provided", () => {
    render(<FiltersHarness />);
    openPanel();
    fireEvent.click(screen.getByLabelText("High-Speed WiFi"));
    fireEvent.click(screen.getByLabelText("Has Outlets"));

    expect(clearAll()).not.toBeInTheDocument();
  });
});
