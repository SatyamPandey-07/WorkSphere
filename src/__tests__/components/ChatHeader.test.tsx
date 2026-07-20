import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import "@testing-library/jest-dom";

jest.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
}));

jest.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function FiltersHarness() {
  const [filters, setFilters] = useState<Record<string, boolean>>({});
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
