describe("Array utilities for venue booking", () => {
  function unique<T>(arr: T[]): T[] { return [...new Set(arr)]; }
  function chunk<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));
  }
  function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
    return arr.reduce((g, i) => ({ ...g, [key(i)]: [...(g[key(i)] ?? []), i] }), {} as Record<string, T[]>);
  }
  function median(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }
  it("unique removes duplicates", () => { expect(unique([1,2,2,3])).toEqual([1,2,3]); });
  it("chunk splits array", () => { expect(chunk([1,2,3,4,5], 2)).toEqual([[1,2],[3,4],[5]]); });
  it("groupBy groups correctly", () => {
    const r = groupBy([{k:"a",v:1},{k:"b",v:2},{k:"a",v:3}], (i)=>i.k);
    expect(r.a.length).toBe(2);
  });
  it("median of odd array", () => { expect(median([3,1,4,1,5])).toBe(3); });
  it("median of even array", () => { expect(median([1,2,3,4])).toBe(2.5); });
});
