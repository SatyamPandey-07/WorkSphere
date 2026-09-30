/**
 * Tests for cursor-based API pagination helpers.
 */

interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

function paginate<T>(
  items: T[],
  cursor: string | null,
  limit: number,
  getId: (item: T) => string
): PageResult<T> {
  let startIdx = 0;
  if (cursor !== null) {
    const idx = items.findIndex((item) => getId(item) === cursor);
    startIdx = idx === -1 ? 0 : idx + 1;
  }
  const page = items.slice(startIdx, startIdx + limit);
  const nextCursor =
    startIdx + limit < items.length ? getId(items[startIdx + limit - 1]) : null;
  return { items: page, nextCursor, hasMore: startIdx + limit < items.length };
}

interface Item { id: string; name: string; }
const ALL: Item[] = Array.from({ length: 10 }, (_, i) => ({
  id: `item-${i + 1}`,
  name: `Item ${i + 1}`,
}));

describe("Cursor-based pagination", () => {
  it("first page returns correct items", () => {
    const { items } = paginate(ALL, null, 3, (x) => x.id);
    expect(items.map((i) => i.id)).toEqual(["item-1", "item-2", "item-3"]);
  });

  it("first page has next cursor", () => {
    const { nextCursor, hasMore } = paginate(ALL, null, 3, (x) => x.id);
    expect(hasMore).toBe(true);
    expect(nextCursor).not.toBeNull();
  });

  it("second page continues from cursor", () => {
    const first = paginate(ALL, null, 3, (x) => x.id);
    const second = paginate(ALL, first.nextCursor, 3, (x) => x.id);
    expect(second.items[0].id).toBe("item-4");
  });

  it("last page has no next cursor", () => {
    const { nextCursor, hasMore } = paginate(ALL, "item-7", 3, (x) => x.id);
    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });

  it("empty items → empty page", () => {
    const { items, hasMore } = paginate([], null, 3, (x: Item) => x.id);
    expect(items).toHaveLength(0);
    expect(hasMore).toBe(false);
  });

  it("limit larger than total → single page", () => {
    const { items, hasMore } = paginate(ALL, null, 20, (x) => x.id);
    expect(items).toHaveLength(10);
    expect(hasMore).toBe(false);
  });
});
