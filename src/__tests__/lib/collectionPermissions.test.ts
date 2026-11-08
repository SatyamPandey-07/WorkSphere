/**
 * Tests for folder/collection access permission checking.
 */

type FolderRole = "OWNER" | "EDITOR" | "VIEWER";

function canEdit(role: FolderRole): boolean {
  return role === "OWNER" || role === "EDITOR";
}

function canDelete(role: FolderRole): boolean {
  return role === "OWNER";
}

function canInvite(role: FolderRole): boolean {
  return role === "OWNER" || role === "EDITOR";
}

function canView(role: FolderRole): boolean {
  return true; // all roles can view
}

describe("Collection/folder permission checks", () => {
  it("OWNER can edit", () => expect(canEdit("OWNER")).toBe(true));
  it("EDITOR can edit", () => expect(canEdit("EDITOR")).toBe(true));
  it("VIEWER cannot edit", () => expect(canEdit("VIEWER")).toBe(false));

  it("OWNER can delete", () => expect(canDelete("OWNER")).toBe(true));
  it("EDITOR cannot delete", () => expect(canDelete("EDITOR")).toBe(false));
  it("VIEWER cannot delete", () => expect(canDelete("VIEWER")).toBe(false));

  it("OWNER can invite", () => expect(canInvite("OWNER")).toBe(true));
  it("EDITOR can invite", () => expect(canInvite("EDITOR")).toBe(true));
  it("VIEWER cannot invite", () => expect(canInvite("VIEWER")).toBe(false));

  it("all roles can view", () => {
    (["OWNER", "EDITOR", "VIEWER"] as FolderRole[]).forEach((role) => {
      expect(canView(role)).toBe(true);
    });
  });

  it("VIEWER has most restricted permissions", () => {
    expect(canEdit("VIEWER")).toBe(false);
    expect(canDelete("VIEWER")).toBe(false);
    expect(canInvite("VIEWER")).toBe(false);
    expect(canView("VIEWER")).toBe(true);
  });
});
