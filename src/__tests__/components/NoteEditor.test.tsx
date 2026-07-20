import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NoteEditor } from "@/components/saved-venues/NoteEditor";

jest.useFakeTimers();

describe("NoteEditor", () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it("shows add note button when empty", () => {
    render(<NoteEditor initialNotes={null} onSave={jest.fn()} />);
    expect(screen.getByText("Add a private note...")).toBeInTheDocument();
  });

  it("shows existing notes as preview", () => {
    render(<NoteEditor initialNotes="My notes" onSave={jest.fn()} />);
    expect(screen.getByText("My notes")).toBeInTheDocument();
  });

  it("opens editor when add button is clicked", () => {
    render(<NoteEditor initialNotes={null} onSave={jest.fn()} />);
    fireEvent.click(screen.getByText("Add a private note..."));
    expect(screen.getByLabelText("Private notes")).toBeInTheDocument();
  });

  it("opens editor when existing note is clicked", () => {
    render(<NoteEditor initialNotes="Existing" onSave={jest.fn()} />);
    fireEvent.click(screen.getByLabelText("Edit note"));
    const textarea = screen.getByLabelText("Private notes");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("Existing");
  });

  it("calls onSave via manual save button", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<NoteEditor initialNotes={null} onSave={onSave} />);
    fireEvent.click(screen.getByText("Add a private note..."));

    const textarea = screen.getByLabelText("Private notes");
    fireEvent.change(textarea, { target: { value: "New note" } });
    fireEvent.click(screen.getByLabelText("Save notes"));

    await act(async () => {
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("New note");
    });
  });

  it("autosaves after debounce delay", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<NoteEditor initialNotes={null} onSave={onSave} />);
    fireEvent.click(screen.getByText("Add a private note..."));

    const textarea = screen.getByLabelText("Private notes");
    fireEvent.change(textarea, { target: { value: "Autosaved note" } });

    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("Autosaved note");
    });
  });

  it("shows character count", () => {
    render(<NoteEditor initialNotes={null} onSave={jest.fn()} />);
    fireEvent.click(screen.getByText("Add a private note..."));
    expect(screen.getByText("0/2000")).toBeInTheDocument();
  });

  it("cancels editing and reverts changes", () => {
    render(<NoteEditor initialNotes="Original" onSave={jest.fn()} />);
    fireEvent.click(screen.getByLabelText("Edit note"));

    const textarea = screen.getByLabelText("Private notes");
    fireEvent.change(textarea, { target: { value: "Changed" } });
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("clears note when saving empty string", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<NoteEditor initialNotes="Old note" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText("Edit note"));

    const textarea = screen.getByLabelText("Private notes");
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Save notes"));

    await act(async () => {
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("");
    });
  });
});
