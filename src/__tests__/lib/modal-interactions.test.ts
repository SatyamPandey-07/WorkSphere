import {
  handleModalBackdropClick,
  isModalBackdropClick,
  shouldCloseFromBackdrop,
} from "@/lib/modal-interactions";

describe("modal backdrop interactions", () => {
  describe("isModalBackdropClick", () => {
    it("returns true when target and currentTarget are the backdrop", () => {
      const backdrop = document.createElement("div");

      expect(
        isModalBackdropClick({
          target: backdrop,
          currentTarget: backdrop,
        }),
      ).toBe(true);
    });

    it("returns false when a click bubbles from modal content", () => {
      const backdrop = document.createElement("div");
      const dialog = document.createElement("div");
      backdrop.appendChild(dialog);

      expect(
        isModalBackdropClick({
          target: dialog,
          currentTarget: backdrop,
        }),
      ).toBe(false);
    });
  });

  describe("handleModalBackdropClick", () => {
    it("calls onClose when the backdrop is clicked", () => {
      const backdrop = document.createElement("div");
      const onClose = jest.fn();

      const didClose = handleModalBackdropClick(
        {
          target: backdrop,
          currentTarget: backdrop,
        },
        onClose,
      );

      expect(didClose).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not call onClose when modal content is clicked", () => {
      const backdrop = document.createElement("div");
      const dialog = document.createElement("div");
      const onClose = jest.fn();
      backdrop.appendChild(dialog);

      const didClose = handleModalBackdropClick(
        {
          target: dialog,
          currentTarget: backdrop,
        },
        onClose,
      );

      expect(didClose).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("shouldCloseFromBackdrop", () => {
    it("closes when the interaction starts and ends on the backdrop", () => {
      expect(shouldCloseFromBackdrop(true, true)).toBe(true);
    });

    it("does not close when a date-control interaction ends on the backdrop", () => {
      expect(shouldCloseFromBackdrop(false, true)).toBe(false);
    });

    it("does not close when interaction starts on backdrop and ends in dialog", () => {
      expect(shouldCloseFromBackdrop(true, false)).toBe(false);
    });

    it("does not close for interactions fully inside the dialog", () => {
      expect(shouldCloseFromBackdrop(false, false)).toBe(false);
    });
  });
});
