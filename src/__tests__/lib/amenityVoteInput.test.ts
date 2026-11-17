import { normalizeRequiredText } from "@/lib/amenityVoteInput";

describe("normalizeRequiredText", () => {
  it.each([
    ["wifi", "wifi"],
    ["  wifi  ", "wifi"],
    ["\n\tstudy table\n", "study table"],
  ])("returns the trimmed value for %p", (input, expected) => {
    expect(normalizeRequiredText(input)).toBe(expected);
  });

  it.each([
    [""],
    ["   "],
    ["\n\t\r "],
    [undefined],
    [null],
    [42],
    [true],
    [{}],
    [[]],
  ])("returns null for %p", (input) => {
    expect(normalizeRequiredText(input)).toBeNull();
  });
});
