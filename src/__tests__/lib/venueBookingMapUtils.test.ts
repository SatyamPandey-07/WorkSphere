describe("Map/Record utilities for venue booking", () => {
  function invertMap(m: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
  }
  function mergeDeep<T extends Record<string, unknown>>(a: T, b: Partial<T>): T {
    const result = { ...a };
    for (const key of Object.keys(b) as (keyof T)[]) {
      if (b[key] !== undefined) result[key] = b[key] as T[typeof key];
    }
    return result;
  }
  function countBy<T>(arr: T[], key: (item: T) => string): Record<string, number> {
    return arr.reduce((m, i) => { const k = key(i); m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>);
  }
  function pickKeys<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): Partial<T> {
    return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]])) as Partial<T>;
  }
  it("invertMap swaps keys/values", () => { expect(invertMap({a:"x",b:"y"})).toEqual({x:"a",y:"b"}); });
  it("mergeDeep overrides keys", () => { expect(mergeDeep({a:1,b:2},{b:3}).b).toBe(3); });
  it("countBy groups", () => { expect(countBy(["a","b","a"],k=>k).a).toBe(2); });
  it("pickKeys selects subset", () => { expect(pickKeys({a:1,b:2,c:3},["a","c"])).toEqual({a:1,c:3}); });
});
