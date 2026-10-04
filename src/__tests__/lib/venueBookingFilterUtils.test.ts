describe("Filter utilities for venue booking", () => {
  const items = [
    { id: 1, category: "conf", price: 100, rating: 4.5, available: true },
    { id: 2, category: "work", price: 50,  rating: 3.8, available: false },
    { id: 3, category: "conf", price: 200, rating: 4.9, available: true },
    { id: 4, category: "work", price: 80,  rating: 4.2, available: true },
  ];
  function filterByCategory(list: typeof items, cat: string): typeof items {
    return list.filter((i) => i.category === cat);
  }
  function filterByAvailability(list: typeof items): typeof items {
    return list.filter((i) => i.available);
  }
  function filterByMaxPrice(list: typeof items, max: number): typeof items {
    return list.filter((i) => i.price <= max);
  }
  function filterByMinRating(list: typeof items, min: number): typeof items {
    return list.filter((i) => i.rating >= min);
  }
  it("filterByCategory: 2 conf items", () => { expect(filterByCategory(items, "conf").length).toBe(2); });
  it("filterByAvailability: 3 available", () => { expect(filterByAvailability(items).length).toBe(3); });
  it("filterByMaxPrice 100: items 1,2,4", () => { expect(filterByMaxPrice(items, 100).length).toBe(3); });
  it("filterByMinRating 4.5: items 1,3", () => { expect(filterByMinRating(items, 4.5).length).toBe(2); });
});
