import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FilterDrawer } from "@/components/search/FilterDrawer";

describe("FilterDrawer Mobile Backdrop Propagation Containment (#8021)", () => {
  it("renders FilterDrawer and consumes backdrop clicks without bubbling to underlying venue cards", () => {
    const handleClose = jest.fn();
    const underlyingCardClick = jest.fn();
    const underlyingCardPointerDown = jest.fn();

    render(
      <div
        data-testid="underlying-venue-card"
        onClick={underlyingCardClick}
        onPointerDown={underlyingCardPointerDown}
      >
        <FilterDrawer isOpen={true} onClose={handleClose} />
      </div>,
    );

    const backdrop = screen.getByTestId("filter-drawer-backdrop");
    expect(backdrop).toBeInTheDocument();
    expect(backdrop).toHaveClass("pointer-events-auto");

    // Simulate mobile touch / pointer down
    fireEvent.pointerDown(backdrop);
    expect(underlyingCardPointerDown).not.toHaveBeenCalled();

    // Simulate mobile click to dismiss drawer
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(underlyingCardClick).not.toHaveBeenCalled();
  });

  it("does not trigger onClose or bubble when clicking inside drawer panel", () => {
    const handleClose = jest.fn();
    const underlyingCardClick = jest.fn();

    render(
      <div onClick={underlyingCardClick}>
        <FilterDrawer isOpen={true} onClose={handleClose} />
      </div>,
    );

    const searchInput = screen.getByTestId("search-input");
    fireEvent.click(searchInput);

    expect(handleClose).not.toHaveBeenCalled();
    expect(underlyingCardClick).not.toHaveBeenCalled();
  });
});
