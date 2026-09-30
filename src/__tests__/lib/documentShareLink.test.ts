/**
 * Tests for collaborative document share link generation and access level.
 */

type ShareAccess = "view" | "comment" | "edit";

interface ShareLink {
  docId: string;
  token: string;
  access: ShareAccess;
  expiresAt: number | null; // null = never expires
  password?: string;
}

function isShareLinkValid(link: ShareLink, nowMs: number): boolean {
  if (link.expiresAt === null) return true;
  return nowMs < link.expiresAt;
}

function canWrite(link: ShareLink): boolean {
  return link.access === "edit";
}

function canComment(link: ShareLink): boolean {
  return link.access === "edit" || link.access === "comment";
}

function requiresPassword(link: ShareLink): boolean {
  return !!link.password;
}

function accessLevel(link: ShareLink): number {
  return { view: 1, comment: 2, edit: 3 }[link.access];
}

const NOW = 1_700_000_000_000;
const VIEW_LINK: ShareLink = { docId: "d1", token: "tok1", access: "view",    expiresAt: NOW + 3_600_000 };
const EDIT_LINK: ShareLink = { docId: "d1", token: "tok2", access: "edit",    expiresAt: null };
const PASS_LINK: ShareLink = { docId: "d1", token: "tok3", access: "comment", expiresAt: NOW + 1000, password: "secret" };

describe("Document share link", () => {
  it("valid link within expiry", () => {
    expect(isShareLinkValid(VIEW_LINK, NOW + 1000)).toBe(true);
  });

  it("expired link → invalid", () => {
    expect(isShareLinkValid(VIEW_LINK, NOW + 4_000_000)).toBe(false);
  });

  it("null expiry → always valid", () => {
    expect(isShareLinkValid(EDIT_LINK, NOW + 999_999_999)).toBe(true);
  });

  it("view link → cannot write", () => {
    expect(canWrite(VIEW_LINK)).toBe(false);
  });

  it("edit link → can write", () => {
    expect(canWrite(EDIT_LINK)).toBe(true);
  });

  it("view link → cannot comment", () => {
    expect(canComment(VIEW_LINK)).toBe(false);
  });

  it("comment link → can comment", () => {
    expect(canComment(PASS_LINK)).toBe(true);
  });

  it("edit link → can comment too", () => {
    expect(canComment(EDIT_LINK)).toBe(true);
  });

  it("link without password → no password required", () => {
    expect(requiresPassword(VIEW_LINK)).toBe(false);
  });

  it("link with password → password required", () => {
    expect(requiresPassword(PASS_LINK)).toBe(true);
  });

  it("accessLevel: view < comment < edit", () => {
    expect(accessLevel(VIEW_LINK)).toBeLessThan(accessLevel(PASS_LINK));
    expect(accessLevel(PASS_LINK)).toBeLessThan(accessLevel(EDIT_LINK));
  });
});
