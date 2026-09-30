/**
 * Tests for booking notes and attachment management.
 */

interface BookingNote {
  noteId: string;
  bookingId: string;
  authorId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  isPrivate: boolean;
  attachments: string[]; // file URLs
}

function canEditNote(note: BookingNote, userId: string): boolean {
  return note.authorId === userId;
}

function updateNoteContent(note: BookingNote, newContent: string, nowMs: number): BookingNote {
  if (!newContent.trim()) throw new Error("Note content cannot be empty");
  return { ...note, content: newContent.trim(), updatedAt: nowMs };
}

function addAttachment(note: BookingNote, url: string): BookingNote {
  if (note.attachments.includes(url)) return note; // no duplicates
  return { ...note, attachments: [...note.attachments, url] };
}

function removeAttachment(note: BookingNote, url: string): BookingNote {
  return { ...note, attachments: note.attachments.filter((a) => a !== url) };
}

function publicNotesForBooking(notes: BookingNote[], bookingId: string): BookingNote[] {
  return notes.filter((n) => n.bookingId === bookingId && !n.isPrivate);
}

const NOW = 1_700_000_000_000;
const NOTE: BookingNote = {
  noteId: "n1", bookingId: "b1", authorId: "u1",
  content: "Please keep quiet zone", createdAt: NOW - 1000, updatedAt: NOW - 1000,
  isPrivate: false, attachments: ["file1.pdf"],
};

describe("Booking notes and attachments", () => {
  it("canEditNote: author can edit", () => {
    expect(canEditNote(NOTE, "u1")).toBe(true);
  });

  it("canEditNote: non-author cannot edit", () => {
    expect(canEditNote(NOTE, "u2")).toBe(false);
  });

  it("updateNoteContent: updates content and timestamp", () => {
    const updated = updateNoteContent(NOTE, "New content", NOW);
    expect(updated.content).toBe("New content");
    expect(updated.updatedAt).toBe(NOW);
  });

  it("updateNoteContent: empty content throws", () => {
    expect(() => updateNoteContent(NOTE, "   ", NOW)).toThrow("cannot be empty");
  });

  it("addAttachment: adds new URL", () => {
    const updated = addAttachment(NOTE, "file2.jpg");
    expect(updated.attachments).toContain("file2.jpg");
    expect(updated.attachments).toHaveLength(2);
  });

  it("addAttachment: duplicate URL ignored", () => {
    const updated = addAttachment(NOTE, "file1.pdf");
    expect(updated.attachments).toHaveLength(1);
  });

  it("removeAttachment: removes URL", () => {
    const updated = removeAttachment(NOTE, "file1.pdf");
    expect(updated.attachments).toHaveLength(0);
  });

  it("publicNotesForBooking: returns only public notes", () => {
    const notes = [NOTE, { ...NOTE, noteId: "n2", isPrivate: true }];
    expect(publicNotesForBooking(notes, "b1")).toHaveLength(1);
  });
});
