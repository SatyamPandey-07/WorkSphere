import { shouldCloseFromBackdrop } from "@/lib/modal-interactions";

describe("shouldCloseFromBackdrop", () => {
  it("closes when the interaction starts and ends on the backdrop", () => {
    expect(shouldCloseFromBackdrop(true, true)).toBe(true);
  });

  it("does not close when a date-control interaction ends on the backdrop", () => {
    expect(shouldCloseFromBackdrop(false, true)).toBe(false);
  });

  it("does not close when the interaction begins on the backdrop and ends in the dialog", () => {
    expect(shouldCloseFromBackdrop(true, false)).toBe(false);
  });

  it("does not close for interactions fully inside the dialog", () => {
    expect(shouldCloseFromBackdrop(false, false)).toBe(false);
  });
});
