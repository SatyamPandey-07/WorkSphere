import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FeedbackTable from "@/app/admin/feedback/FeedbackTable";
import { dismissFlag, deleteFlaggedItem } from "@/app/admin/actions";
import { downloadFeedbackCSV } from "@/lib/feedbackCsvExport";

jest.mock("@/app/admin/actions", () => ({
  dismissFlag: jest.fn(),
  deleteFlaggedItem: jest.fn(),
}));

jest.mock("@/lib/feedbackCsvExport", () => ({
  downloadFeedbackCSV: jest.fn(),
}));

describe("FeedbackTable Component (#6792)", () => {
  const mockFlags: any[] = [
    {
      id: "flag-1",
      type: "VENUE",
      reason: "Incorrect pricing",
      status: "PENDING",
      createdAt: new Date("2026-10-15T10:00:00.000Z"),
      reportedBy: {
        firstName: "Grace",
        lastName: "Hopper",
        email: "grace@example.com",
      },
      itemDetails: {
        name: "Central Coworking Space",
      },
    },
    {
      id: "flag-2",
      type: "REVIEW",
      reason: "Harassment in review",
      status: "PENDING",
      createdAt: "2026-10-16T12:00:00.000Z",
      reportedBy: {
        firstName: "Alan",
        lastName: "Turing",
        email: "alan@example.com",
      },
      itemDetails: {
        comment: "Very hostile environment",
        venue: {
          name: "Cafe Turing",
        },
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
    window.alert = jest.fn();
  });

  it("renders empty state when there are no flags", () => {
    render(<FeedbackTable initialFlags={[]} />);
    expect(screen.getByText("All Caught Up!")).toBeInTheDocument();
    expect(
      screen.getByText("There are no pending flags to review."),
    ).toBeInTheDocument();
  });

  it("renders table with venue and review flags", () => {
    render(<FeedbackTable initialFlags={mockFlags} />);
    expect(screen.getByText("VENUE")).toBeInTheDocument();
    expect(screen.getByText("REVIEW")).toBeInTheDocument();
    expect(screen.getByText("Central Coworking Space")).toBeInTheDocument();
    expect(screen.getByText('"Very hostile environment"')).toBeInTheDocument();
    expect(screen.getByText(/Venue: Cafe Turing/)).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
  });

  it("triggers CSV export when clicking Export CSV button", () => {
    render(<FeedbackTable initialFlags={mockFlags} />);
    const exportButton = screen.getByRole("button", { name: /Export CSV/i });
    fireEvent.click(exportButton);
    expect(downloadFeedbackCSV).toHaveBeenCalledTimes(1);
    expect(downloadFeedbackCSV).toHaveBeenCalledWith(mockFlags);
  });

  it("calls dismissFlag and removes row when clicking Dismiss", async () => {
    (dismissFlag as jest.Mock).mockResolvedValueOnce({ success: true });
    render(<FeedbackTable initialFlags={mockFlags} />);

    const dismissButtons = screen.getAllByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissButtons[0]);

    await waitFor(() => {
      expect(dismissFlag).toHaveBeenCalledWith("flag-1");
      expect(screen.queryByText("Central Coworking Space")).not.toBeInTheDocument();
    });
  });

  it("calls deleteFlaggedItem and removes row when confirming Delete", async () => {
    (deleteFlaggedItem as jest.Mock).mockResolvedValueOnce({ success: true });
    render(<FeedbackTable initialFlags={mockFlags} />);

    const deleteButtons = screen.getAllByRole("button", { name: "Delete Item" });
    fireEvent.click(deleteButtons[1]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(deleteFlaggedItem).toHaveBeenCalledWith("flag-2");
      expect(screen.queryByText('"Very hostile environment"')).not.toBeInTheDocument();
    });
  });

  it("does not call deleteFlaggedItem if user cancels confirmation", async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    render(<FeedbackTable initialFlags={mockFlags} />);

    const deleteButtons = screen.getAllByRole("button", { name: "Delete Item" });
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteFlaggedItem).not.toHaveBeenCalled();
    expect(screen.getByText("Central Coworking Space")).toBeInTheDocument();
  });

  it("safely renders rows with null reportedBy and invalid createdAt dates", () => {
    const rawFlags: any[] = [
      {
        id: "flag-anon",
        type: "VENUE",
        reason: "Noise complaint",
        status: "PENDING",
        createdAt: "invalid-date",
        reportedBy: null,
        itemDetails: null,
      },
    ];

    expect(() => render(<FeedbackTable initialFlags={rawFlags} />)).not.toThrow();
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
