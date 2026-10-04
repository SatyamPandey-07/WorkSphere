describe("Sort utilities for venue booking lists", () => {
  const venues = [
    { id: "v1", name: "Zeta", rating: 4.5, price: 200 },
    { id: "v2", name: "Alpha", rating: 4.8, price: 150 },
    { id: "v3", name: "Gamma", rating: 4.2, price: 250 },
  ];
  function sortByRating(list: typeof venues): typeof venues {
    return [...list].sort((a, b) => b.rating - a.rating);
  }
  function sortByPrice(list: typeof venues): typeof venues {
    return [...list].sort((a, b) => a.price - b.price);
  }
  function sortByName(list: typeof venues): typeof venues {
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }
  it("sortByRating: highest first", () => { expect(sortByRating(venues)[0].id).toBe("v2"); });
  it("sortByPrice: cheapest first", () => { expect(sortByPrice(venues)[0].id).toBe("v2"); });
  it("sortByName: Alpha first", () => { expect(sortByName(venues)[0].name).toBe("Alpha"); });
  it("sortByRating is immutable", () => {
    const ids = venues.map((v) => v.id);
    sortByRating(venues);
    expect(venues.map((v) => v.id)).toEqual(ids);
  });
});
