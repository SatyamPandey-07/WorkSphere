/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { GroupNotesEditor } from "@/components/notes/GroupNotesEditor";

jest.mock("y-partykit/provider", () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    off: jest.fn(),
    disconnect: jest.fn(),
  }));
});

jest.mock("@/lib/crdt/notesOutbox", () => ({
  enqueueNotesUpdate: jest.fn().mockResolvedValue(undefined),
  flushNotesOutbox: jest.fn().mockResolvedValue(0),
  loadNotesDocState: jest.fn().mockResolvedValue(null),
  saveNotesDocState: jest.fn().mockResolvedValue(undefined),
}));

describe("GroupNotesEditor", () => {
  it("renders the rich-text group notes chrome", () => {
    render(<GroupNotesEditor roomId="cowork-1" />);
    expect(screen.getByText(/Group Notes/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Coworking group notes editor/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByLabelText("Italic")).toBeInTheDocument();
  });
});
