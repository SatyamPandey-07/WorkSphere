import React from "react";
import { render, screen } from "@testing-library/react";
import RemoteCursors, {
  RemoteCursors as NamedRemoteCursors,
} from "@/components/whiteboard/RemoteCursors";
import { useSmoothCursor } from "@/hooks/useSmoothCursor";
import type { RemoteCursor } from "@/hooks/useCanvasWhiteboard";

const mockSetTarget = jest.fn();

jest.mock("@/hooks/useSmoothCursor", () => ({
  useSmoothCursor: jest.fn(),
}));

describe("RemoteCursors Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSmoothCursor as jest.Mock).mockImplementation((_userId, initialX, initialY) => ({
      state: {
        x: initialX,
        y: initialY,
        vx: 0,
        vy: 0,
        targetX: initialX,
        targetY: initialY,
        isVisible: true,
        lastUpdate: Date.now(),
      },
      setTarget: mockSetTarget,
      hide: jest.fn(),
    }));
  });

  it("exports named RemoteCursors and default RemoteCursors", () => {
    expect(RemoteCursors).toBeDefined();
    expect(NamedRemoteCursors).toBe(RemoteCursors);
  });

  it("returns null when cursors is empty array, undefined, or null", () => {
    const { container: empty } = render(<RemoteCursors cursors={[]} />);
    expect(empty.firstChild).toBeNull();

    const { container: undef } = render(<RemoteCursors cursors={undefined} />);
    expect(undef.firstChild).toBeNull();

    const { container: nil } = render(<RemoteCursors cursors={null as any} />);
    expect(nil.firstChild).toBeNull();
  });

  it("renders remote cursor items with user name, color, and coordinates", () => {
    const cursors: RemoteCursor[] = [
      {
        userId: "user-1",
        name: "Alice Nomad",
        color: "#3b82f6",
        x: 120,
        y: 240,
        lastUpdate: Date.now(),
      },
      {
        userId: "user-2",
        name: "Bob Coworker",
        color: "#ef4444",
        x: 350,
        y: 450,
        lastUpdate: Date.now(),
      },
    ];

    render(<RemoteCursors cursors={cursors} />);

    expect(screen.getByTestId("remote-cursors-layer")).toBeInTheDocument();
    expect(screen.getByTestId("remote-cursor-user-1")).toBeInTheDocument();
    expect(screen.getByTestId("remote-cursor-user-2")).toBeInTheDocument();

    expect(screen.getByText("Alice Nomad")).toBeInTheDocument();
    expect(screen.getByText("Bob Coworker")).toBeInTheDocument();

    const aliceItem = screen.getByTestId("remote-cursor-user-1");
    expect(aliceItem).toHaveStyle({ left: "120px", top: "240px", opacity: 1 });
  });

  it("does not render cursor item when isVisible is false", () => {
    (useSmoothCursor as jest.Mock).mockReturnValue({
      state: {
        x: 100,
        y: 100,
        vx: 0,
        vy: 0,
        targetX: 100,
        targetY: 100,
        isVisible: false,
        lastUpdate: Date.now(),
      },
      setTarget: mockSetTarget,
      hide: jest.fn(),
    });

    const cursors: RemoteCursor[] = [
      {
        userId: "hidden-user",
        name: "Hidden User",
        color: "#10b981",
        x: 100,
        y: 100,
        lastUpdate: Date.now(),
      },
    ];

    render(<RemoteCursors cursors={cursors} />);
    expect(screen.queryByTestId("remote-cursor-hidden-user")).toBeNull();
  });

  it("reduces opacity to 0.4 when cursor is inactive for more than 4000ms", () => {
    (useSmoothCursor as jest.Mock).mockReturnValue({
      state: {
        x: 150,
        y: 200,
        vx: 0,
        vy: 0,
        targetX: 150,
        targetY: 200,
        isVisible: true,
        lastUpdate: Date.now() - 5000, // 5 seconds ago
      },
      setTarget: mockSetTarget,
      hide: jest.fn(),
    });

    const cursors: RemoteCursor[] = [
      {
        userId: "idle-user",
        name: "Idle User",
        color: "#8b5cf6",
        x: 150,
        y: 200,
        lastUpdate: Date.now() - 5000,
      },
    ];

    render(<RemoteCursors cursors={cursors} />);

    const cursorEl = screen.getByTestId("remote-cursor-idle-user");
    expect(cursorEl).toHaveStyle({ opacity: 0.4 });
  });

  it("calls setTarget when cursor coordinates update", () => {
    const initialCursors: RemoteCursor[] = [
      {
        userId: "moving-user",
        name: "Moving User",
        color: "#f59e0b",
        x: 50,
        y: 50,
        lastUpdate: Date.now(),
      },
    ];

    const { rerender } = render(<RemoteCursors cursors={initialCursors} />);
    expect(mockSetTarget).toHaveBeenCalledWith(50, 50);

    const updatedCursors: RemoteCursor[] = [
      {
        userId: "moving-user",
        name: "Moving User",
        color: "#f59e0b",
        x: 180,
        y: 220,
        lastUpdate: Date.now(),
      },
    ];

    rerender(<RemoteCursors cursors={updatedCursors} />);
    expect(mockSetTarget).toHaveBeenCalledWith(180, 220);
  });

  it("merges custom className and supports data-testid override", () => {
    const cursors: RemoteCursor[] = [
      {
        userId: "user-test",
        name: "Test User",
        color: "#06b6d4",
        x: 10,
        y: 10,
        lastUpdate: Date.now(),
      },
    ];

    render(
      <RemoteCursors
        cursors={cursors}
        className="custom-cursors-overlay"
        data-testid="custom-cursors-layer"
      />
    );

    const layer = screen.getByTestId("custom-cursors-layer");
    expect(layer).toHaveClass("custom-cursors-overlay", "pointer-events-none");
  });
});
