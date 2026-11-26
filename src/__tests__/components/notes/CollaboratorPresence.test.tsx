/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CollaboratorPresence } from "@/components/notes/CollaboratorPresence";

describe("CollaboratorPresence", () => {
  it("renders null when peers list is empty", () => {
    const { container } = render(<CollaboratorPresence peers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders connected collaborators with name, avatar, and cursor index", () => {
    const peers = [
      {
        clientId: 2,
        name: "Alice",
        avatarUrl: "https://example.com/alice.jpg",
        color: "#2563eb",
        cursorIndex: 12,
      },
    ];
    render(<CollaboratorPresence peers={peers} />);
    expect(screen.getByTestId("awareness-cursors-bar")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@12")).toBeInTheDocument();
    const avatar = screen.getByAltText("Alice");
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute("src", "https://example.com/alice.jpg");
  });

  it("gracefully handles missing name with fallback", () => {
    const peers = [
      {
        clientId: 42,
        name: "",
        color: "#16a34a",
      },
    ];
    render(<CollaboratorPresence peers={peers} />);
    expect(screen.getByText("User 42")).toBeInTheDocument();
  });

  it("gracefully falls back to initials when avatarUrl is missing", () => {
    const peers = [
      {
        clientId: 3,
        name: "Bob Builder",
        color: "#d97706",
      },
    ];
    render(<CollaboratorPresence peers={peers} />);
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
  });

  it("falls back to initials when avatar image fails to load (onError)", () => {
    const peers = [
      {
        clientId: 5,
        name: "Charlie",
        avatarUrl: "https://example.com/broken.jpg",
        color: "#9333ea",
      },
    ];
    render(<CollaboratorPresence peers={peers} />);
    const img = screen.getByAltText("Charlie");
    fireEvent.error(img);
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("deduplicates peer clientIds", () => {
    const peers = [
      { clientId: 2, name: "Alice", color: "#2563eb" },
      { clientId: 2, name: "Alice Duplicate", color: "#2563eb" },
    ];
    render(<CollaboratorPresence peers={peers} />);
    const matches = screen.getAllByLabelText(/Collaborator:/i);
    expect(matches).toHaveLength(1);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});
