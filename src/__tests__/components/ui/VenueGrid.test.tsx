import React from "react";
import { render, screen } from "@testing-library/react";
import VenueGridDefault, {
  VenueGrid,
  LayoutBoundary,
  AnimatedLayoutChild,
  SubgridCell,
} from "@/components/ui/VenueGrid";

describe("VenueGrid Component Suite", () => {
  describe("VenueGrid", () => {
    it("renders default export identical to named export", () => {
      expect(VenueGridDefault).toBe(VenueGrid);
    });

    it("renders children in card view with subgrid classes by default", () => {
      render(
        <VenueGrid>
          <div>Item 1</div>
          <div>Item 2</div>
        </VenueGrid>
      );

      const grid = screen.getByTestId("venue-listings-grid");
      expect(grid).toBeInTheDocument();
      expect(grid).toHaveTextContent("Item 1");
      expect(grid).toHaveTextContent("Item 2");
      expect(grid.className).toContain("[grid-auto-flow:dense]");
      expect(grid.className).toContain("auto-rows-fr");
    });

    it("renders card view without subgrid dense flow when useSubgrid is false", () => {
      render(
        <VenueGrid useSubgrid={false}>
          <div>Fallback Item</div>
        </VenueGrid>
      );

      const grid = screen.getByTestId("venue-listings-grid");
      expect(grid).toBeInTheDocument();
      expect(grid.className).toContain("grid-cols-1");
      expect(grid.className).not.toContain("[grid-auto-flow:dense]");
    });

    it("renders in list view when viewMode is 'list'", () => {
      render(
        <VenueGrid viewMode="list">
          <div>List Row 1</div>
          <div>List Row 2</div>
        </VenueGrid>
      );

      const list = screen.getByTestId("venue-listings-list");
      expect(list).toBeInTheDocument();
      expect(list.className).toContain("space-y-2");
      expect(list).toHaveTextContent("List Row 1");
      expect(list).toHaveTextContent("List Row 2");
    });

    it("accepts custom className and data-testid overrides in both modes", () => {
      const { rerender } = render(
        <VenueGrid className="custom-card-class" data-testid="custom-card-grid">
          <div>Card</div>
        </VenueGrid>
      );

      const customCard = screen.getByTestId("custom-card-grid");
      expect(customCard).toBeInTheDocument();
      expect(customCard.className).toContain("custom-card-class");

      rerender(
        <VenueGrid
          viewMode="list"
          className="custom-list-class"
          data-testid="custom-list-grid"
        >
          <div>List</div>
        </VenueGrid>
      );

      const customList = screen.getByTestId("custom-list-grid");
      expect(customList).toBeInTheDocument();
      expect(customList.className).toContain("custom-list-class");
    });
  });

  describe("LayoutBoundary", () => {
    it("renders children, forwarded ref, and default testid", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <LayoutBoundary ref={ref} minHeight={240} className="boundary-extra">
          <span>Boundary Content</span>
        </LayoutBoundary>
      );

      const el = screen.getByTestId("layout-boundary");
      expect(el).toBeInTheDocument();
      expect(ref.current).toBe(el);
      expect(el).toHaveTextContent("Boundary Content");
      expect(el.style.position).toBe("relative");
      expect(el.style.minHeight).toBe("240px");
      expect(el.className).toContain("boundary-extra");
    });

    it("supports custom data-testid override", () => {
      render(
        <LayoutBoundary data-testid="my-boundary">
          <div>Test</div>
        </LayoutBoundary>
      );

      expect(screen.getByTestId("my-boundary")).toBeInTheDocument();
    });
  });

  describe("AnimatedLayoutChild", () => {
    it("renders children, forwarded ref, and animated attributes", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <AnimatedLayoutChild ref={ref} layoutId="child-1" className="child-extra">
          <span>Child Content</span>
        </AnimatedLayoutChild>
      );

      const el = screen.getByTestId("animated-layout-child");
      expect(el).toBeInTheDocument();
      expect(ref.current).toBe(el);
      expect(el).toHaveTextContent("Child Content");
      expect(el.className).toContain("child-extra");
      expect(el.className).toContain("[transform:translate3d(0,0,0)]");
    });

    it("supports custom data-testid override", () => {
      render(
        <AnimatedLayoutChild data-testid="custom-child">
          <div>Inner</div>
        </AnimatedLayoutChild>
      );

      expect(screen.getByTestId("custom-child")).toBeInTheDocument();
    });
  });

  describe("SubgridCell", () => {
    it("renders children, forwarded ref, and span 1 gridRow styling", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <SubgridCell ref={ref} className="cell-extra">
          <span>Cell Content</span>
        </SubgridCell>
      );

      const el = screen.getByTestId("subgrid-cell");
      expect(el).toBeInTheDocument();
      expect(ref.current).toBe(el);
      expect(el).toHaveTextContent("Cell Content");
      expect(el.style.gridRow).toBe("span 1");
      expect(el.className).toContain("cell-extra");
    });

    it("supports custom data-testid override", () => {
      render(
        <SubgridCell data-testid="custom-cell">
          <div>Cell Text</div>
        </SubgridCell>
      );

      expect(screen.getByTestId("custom-cell")).toBeInTheDocument();
    });
  });
});
