/**
 * Tests for collaborative document version tracking.
 */

interface DocVersion {
  versionId: number;
  authorId: string;
  timestamp: number;
  content: string;
  changeSize: number; // chars added/removed
}

function latestVersion(versions: DocVersion[]): DocVersion | null {
  if (versions.length === 0) return null;
  return versions.reduce((latest, v) => v.versionId > latest.versionId ? v : latest);
}

function versionsBetween(
  versions: DocVersion[],
  fromId: number,
  toId: number
): DocVersion[] {
  return versions
    .filter((v) => v.versionId >= fromId && v.versionId <= toId)
    .sort((a, b) => a.versionId - b.versionId);
}

function totalEdits(versions: DocVersion[], authorId: string): number {
  return versions.filter((v) => v.authorId === authorId).length;
}

function hasConflict(v1: DocVersion, v2: DocVersion): boolean {
  return v1.authorId !== v2.authorId && v1.timestamp === v2.timestamp;
}

const BASE = 1_700_000_000_000;
const VERSIONS: DocVersion[] = [
  { versionId: 1, authorId: "alice", timestamp: BASE,        content: "hello",       changeSize: 5  },
  { versionId: 2, authorId: "bob",   timestamp: BASE + 100,  content: "hello world", changeSize: 6  },
  { versionId: 3, authorId: "alice", timestamp: BASE + 200,  content: "hi world",    changeSize: -2 },
];

describe("Collaborative document versioning", () => {
  it("latestVersion returns highest versionId", () => {
    expect(latestVersion(VERSIONS)!.versionId).toBe(3);
  });

  it("latestVersion returns null for empty", () => {
    expect(latestVersion([])).toBeNull();
  });

  it("versionsBetween returns inclusive range", () => {
    const slice = versionsBetween(VERSIONS, 1, 2);
    expect(slice).toHaveLength(2);
    expect(slice[0].versionId).toBe(1);
  });

  it("versionsBetween ordered by versionId", () => {
    const slice = versionsBetween([...VERSIONS].reverse(), 1, 3);
    expect(slice[0].versionId).toBe(1);
    expect(slice[2].versionId).toBe(3);
  });

  it("totalEdits counts by author", () => {
    expect(totalEdits(VERSIONS, "alice")).toBe(2);
    expect(totalEdits(VERSIONS, "bob")).toBe(1);
  });

  it("totalEdits unknown author → 0", () => {
    expect(totalEdits(VERSIONS, "carol")).toBe(0);
  });

  it("hasConflict: same timestamp different authors → true", () => {
    const a: DocVersion = { versionId: 4, authorId: "alice", timestamp: BASE + 300, content: "a", changeSize: 1 };
    const b: DocVersion = { versionId: 5, authorId: "bob",   timestamp: BASE + 300, content: "b", changeSize: 1 };
    expect(hasConflict(a, b)).toBe(true);
  });

  it("hasConflict: different timestamps → false", () => {
    expect(hasConflict(VERSIONS[0], VERSIONS[1])).toBe(false);
  });
});
