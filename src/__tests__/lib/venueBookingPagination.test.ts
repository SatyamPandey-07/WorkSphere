describe("Pagination utilities for venue booking API", () => {
  function paginate<T>(items: T[], page: number, perPage: number): T[] {
    return items.slice((page - 1) * perPage, page * perPage);
  }
  function totalPages(totalItems: number, perPage: number): number {
    return Math.ceil(totalItems / perPage);
  }
  function paginationMeta(page: number, perPage: number, total: number) {
    return {
      page, perPage, total,
      totalPages: totalPages(total, perPage),
      hasNext: page < totalPages(total, perPage),
      hasPrev: page > 1,
    };
  }
  const items = Array.from({ length: 25 }, (_, i) => i + 1);
  it("paginate page 1 of 10", () => { expect(paginate(items, 1, 10)).toEqual([1,2,3,4,5,6,7,8,9,10]); });
  it("paginate page 3 returns last 5", () => { expect(paginate(items, 3, 10)).toEqual([21,22,23,24,25]); });
  it("totalPages 25/10 = 3", () => { expect(totalPages(25, 10)).toBe(3); });
  it("page 1 has no prev", () => { expect(paginationMeta(1, 10, 25).hasPrev).toBe(false); });
  it("page 2 has prev and next", () => {
    const m = paginationMeta(2, 10, 25);
    expect(m.hasPrev).toBe(true);
    expect(m.hasNext).toBe(true);
  });
});
