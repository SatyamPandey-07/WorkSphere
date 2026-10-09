import { fireEvent, render, screen } from "@testing-library/react";
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
});
