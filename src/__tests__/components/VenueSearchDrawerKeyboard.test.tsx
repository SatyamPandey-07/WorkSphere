import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueSearchDrawer } from "@/components/venues/VenueSearchDrawer";

describe("VenueSearchDrawer keyboard navigation and focus management", () => {
  it("closes the drawer when Escape is pressed inside the panel", () => {
    const onClose = jest.fn();
    render(<VenueSearchDrawer isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId("category-all"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close the drawer when Escape clears the search input", () => {
    const onClose = jest.fn();
    render(<VenueSearchDrawer isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId("search-input"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus to the search input when the drawer opens", () => {
    render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);

    expect(screen.getByTestId("search-input")).toHaveFocus();
  });

  it("wraps focus from the last control to the first on Tab", () => {
    render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);
    const first = screen.getByRole("button", { name: "Close search filters" });
    const last = screen.getByTestId("apply-filters-btn");

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });

    expect(first).toHaveFocus();
  });

  it("wraps focus from the first control to the last on Shift+Tab", () => {
    render(<VenueSearchDrawer isOpen={true} onClose={jest.fn()} />);
    const first = screen.getByRole("button", { name: "Close search filters" });
    const last = screen.getByTestId("apply-filters-btn");

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });

    expect(last).toHaveFocus();
  });

  it("returns focus to the trigger button when the drawer closes", () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button data-testid="drawer-trigger" onClick={() => setOpen(true)}>
            Open filters
          </button>
          <VenueSearchDrawer isOpen={open} onClose={() => setOpen(false)} />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByTestId("drawer-trigger");
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTestId("search-input")).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});