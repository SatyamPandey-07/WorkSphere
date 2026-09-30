/**
 * Tests for draft content auto-save debounce logic.
 */

interface DraftState {
  id: string;
  content: string;
  savedAt: number | null;
  isDirty: boolean;
}

function markDirty(draft: DraftState, newContent: string): DraftState {
  return { ...draft, content: newContent, isDirty: true };
}

function saveDraft(draft: DraftState, nowMs: number): DraftState {
  return { ...draft, savedAt: nowMs, isDirty: false };
}

function shouldAutosave(draft: DraftState, nowMs: number, debounceMs = 2000): boolean {
  if (!draft.isDirty) return false;
  if (draft.savedAt === null) return true;
  return nowMs - draft.savedAt >= debounceMs;
}

function formatLastSaved(draft: DraftState, nowMs: number): string {
  if (!draft.savedAt) return "Never saved";
  const sec = Math.floor((nowMs - draft.savedAt) / 1000);
  if (sec < 60) return `Saved ${sec}s ago`;
  return `Saved ${Math.floor(sec / 60)}m ago`;
}

const NOW = 1_700_000_000_000;
const CLEAN_DRAFT: DraftState = { id: "d1", content: "Hello", savedAt: NOW - 1000, isDirty: false };
const DIRTY_DRAFT: DraftState = { id: "d2", content: "Draft", savedAt: NOW - 5000, isDirty: true };

describe("Draft content auto-save", () => {
  it("markDirty sets isDirty and new content", () => {
    const updated = markDirty(CLEAN_DRAFT, "New text");
    expect(updated.isDirty).toBe(true);
    expect(updated.content).toBe("New text");
  });

  it("markDirty is immutable", () => {
    markDirty(CLEAN_DRAFT, "X");
    expect(CLEAN_DRAFT.isDirty).toBe(false);
  });

  it("saveDraft clears isDirty and sets savedAt", () => {
    const saved = saveDraft(DIRTY_DRAFT, NOW);
    expect(saved.isDirty).toBe(false);
    expect(saved.savedAt).toBe(NOW);
  });

  it("shouldAutosave: dirty and debounce elapsed → true", () => {
    expect(shouldAutosave(DIRTY_DRAFT, NOW, 2000)).toBe(true);
  });

  it("shouldAutosave: dirty but debounce not elapsed → false", () => {
    const recentDirty: DraftState = { ...DIRTY_DRAFT, savedAt: NOW - 500 };
    expect(shouldAutosave(recentDirty, NOW, 2000)).toBe(false);
  });

  it("shouldAutosave: clean draft → false", () => {
    expect(shouldAutosave(CLEAN_DRAFT, NOW)).toBe(false);
  });

  it("shouldAutosave: null savedAt → true (first save)", () => {
    const unsaved: DraftState = { id: "d3", content: "Hi", savedAt: null, isDirty: true };
    expect(shouldAutosave(unsaved, NOW)).toBe(true);
  });

  it("formatLastSaved: never saved", () => {
    const unsaved: DraftState = { ...DIRTY_DRAFT, savedAt: null };
    expect(formatLastSaved(unsaved, NOW)).toBe("Never saved");
  });

  it("formatLastSaved: seconds ago", () => {
    expect(formatLastSaved(CLEAN_DRAFT, NOW)).toMatch(/Saved \d+s ago/);
  });
});
