import { act, fireEvent, render, screen } from "@testing-library/react";
import { StickyNotes } from "@/components/whiteboard/StickyNotes";

describe("StickyNotes", () => {
  it("renders markdown preview and updates text collaboratively", () => {
    const onUpdate = jest.fn();

    render(
      <StickyNotes
        notes={[
          {
            id: "note-1",
            type: "sticky",
            points: [20, 30, 260, 190],
            color: "#fbbf24",
            width: 2,
            opacity: 1,
            userId: "user-1",
            text: "**Shared note**",
          },
        ]}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText("Shared note")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Edit sticky note note-1"), {
      target: { value: "# Updated" },
    });
    expect(onUpdate).toHaveBeenCalledWith("note-1", { text: "# Updated" });
  });

  it("moves and resizes notes through pointer interactions", () => {
    const onUpdate = jest.fn();

    render(
      <StickyNotes
        notes={[
          {
            id: "note-2",
            type: "sticky",
            points: [20, 30, 260, 190],
            color: "#fbbf24",
            width: 2,
            opacity: 1,
            userId: "user-1",
            text: "Note",
          },
        ]}
        onUpdate={onUpdate}
      />,
    );

    const note = screen.getByTestId("sticky-note-note-2");
    const header = note.querySelector("div")!;
    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 1 },
      });
      fireEvent(header, event);
    };
    pointerEvent("pointerdown", 20, 30);
    pointerEvent("pointermove", 40, 50);
    expect(onUpdate).toHaveBeenCalledWith("note-2", {
      points: [40, 50, 280, 210],
    });

    const resizeHandle = screen.getByLabelText("Resize sticky note note-2");
    const resizeEvent = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 1 },
      });
      fireEvent(resizeHandle, event);
    };
    resizeEvent("pointerdown", 260, 190);
    resizeEvent("pointermove", 300, 220);
    expect(onUpdate).toHaveBeenLastCalledWith("note-2", {
      points: [20, 30, 300, 220],
    });
  });

  it("waits for a note lease before applying drag coordinates and releases on pointer up", async () => {
    const onUpdate = jest.fn();
    const onAcquireLease = jest.fn().mockResolvedValue(true);
    const onReleaseLease = jest.fn();

    render(
      <StickyNotes
        notes={[
          {
            id: "note-3",
            type: "sticky",
            points: [20, 30, 260, 190],
            color: "#fbbf24",
            width: 2,
            opacity: 1,
            userId: "user-1",
            text: "Note",
          },
        ]}
        onUpdate={onUpdate}
        onAcquireLease={onAcquireLease}
        onReleaseLease={onReleaseLease}
        userId="user-1"
      />,
    );

    const header = screen.getByTestId("sticky-note-note-3").querySelector("div")!;
    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 1 },
      });
      fireEvent(header, event);
    };

    await act(async () => {
      pointerEvent("pointerdown", 20, 30);
      pointerEvent("pointermove", 40, 50);
      await Promise.resolve();
    });
    expect(onAcquireLease).toHaveBeenCalledWith("note-3");
    expect(onUpdate).toHaveBeenCalledWith("note-3", {
      points: [40, 50, 280, 210],
    });

    pointerEvent("pointerup", 40, 50);
    expect(onReleaseLease).toHaveBeenCalledWith("note-3");
  });

  it("does not start a drag when another user holds the note lease", () => {
    const onUpdate = jest.fn();
    const onAcquireLease = jest.fn().mockResolvedValue(true);

    render(
      <StickyNotes
        notes={[
          {
            id: "note-4",
            type: "sticky",
            points: [20, 30, 260, 190],
            color: "#fbbf24",
            width: 2,
            opacity: 1,
            userId: "user-1",
            text: "Note",
          },
        ]}
        onUpdate={onUpdate}
        onAcquireLease={onAcquireLease}
        noteLeaseOwners={{ "note-4": "user-2" }}
        userId="user-1"
      />,
    );

    const header = screen.getByTestId("sticky-note-note-4").querySelector("div")!;
    fireEvent.pointerDown(header, { clientX: 20, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: 40, clientY: 50, pointerId: 1 });

    expect(onAcquireLease).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
