import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import { VibeTags } from "@/components/venue/VibeTags";

describe("VibeTags Component (#4369)", () => {
  describe("Early Return Null Guard for Empty & Undefined Tags", () => {
    it("returns null and renders nothing when tags prop is undefined", () => {
      const { container } = render(<VibeTags tags={undefined} />);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("vibe-tags-container")).not.toBeInTheDocument();
    });

    it("returns null and renders nothing when tags prop is null", () => {
      const { container } = render(<VibeTags tags={null} />);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("vibe-tags-container")).not.toBeInTheDocument();
    });

    it("returns null and renders nothing when tags prop is an empty array []", () => {
      const { container } = render(<VibeTags tags={[]} />);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("vibe-tags-container")).not.toBeInTheDocument();
    });

    it("returns null when tags array contains only empty or whitespace strings", () => {
      const { container } = render(<VibeTags tags={["", "   ", "\t", "\n"]} />);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("vibe-tags-container")).not.toBeInTheDocument();
    });

    it("returns null when tags prop is passed as an invalid non-array type", () => {
      // @ts-expect-error Testing invalid runtime prop input
      const { container } = render(<VibeTags tags="invalid_string" />);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("vibe-tags-container")).not.toBeInTheDocument();
    });

    it("returns null when tags prop is passed as a number or object", () => {
      // @ts-expect-error Testing invalid runtime prop input
      const { container: c1 } = render(<VibeTags tags={123} />);
      expect(c1).toBeEmptyDOMElement();

      // @ts-expect-error Testing invalid runtime prop input
      const { container: c2 } = render(<VibeTags tags={{ tag: "cozy" }} />);
      expect(c2).toBeEmptyDOMElement();
    });
  });

  describe("Tag Rendering & Formatting", () => {
    it("renders container and badge elements when valid tags are provided", () => {
      const tags = ["cozy", "quiet", "fast-wifi"];
      render(<VibeTags tags={tags} />);

      const container = screen.getByTestId("vibe-tags-container");
      expect(container).toBeInTheDocument();

      const tagCozy = screen.getByTestId("vibe-tag-cozy");
      expect(tagCozy).toBeInTheDocument();
      expect(tagCozy).toHaveTextContent("cozy");

      const tagQuiet = screen.getByTestId("vibe-tag-quiet");
      expect(tagQuiet).toBeInTheDocument();
      expect(tagQuiet).toHaveTextContent("quiet");

      const tagWifi = screen.getByTestId("vibe-tag-fast-wifi");
      expect(tagWifi).toBeInTheDocument();
      expect(tagWifi).toHaveTextContent("fast-wifi");
    });

    it("filters out empty or whitespace-only elements while rendering valid tags", () => {
      const tags = ["aesthetic", "", "   ", "spacious"];
      render(<VibeTags tags={tags} />);

      expect(screen.getByTestId("vibe-tag-aesthetic")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-spacious")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tag-")).not.toBeInTheDocument();
    });

    it("formats spaces and special characters in data-testid attributes correctly", () => {
      const tags = ["good coffee", "pet friendly"];
      render(<VibeTags tags={tags} />);

      expect(screen.getByTestId("vibe-tag-good-coffee")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-pet-friendly")).toBeInTheDocument();
    });

    it("applies capitalization CSS class to tag text spans", () => {
      render(<VibeTags tags={["chill"]} />);
      const tagSpan = screen.getByTestId("vibe-tag-chill").querySelector("span");
      expect(tagSpan).toHaveClass("capitalize");
    });
  });

  describe("Pagination & maxDisplay Limit", () => {
    it("limits rendered tags to maxDisplay (default: 4) and displays overflow badge", () => {
      const tags = ["cozy", "quiet", "spacious", "lively", "focused", "bright"];
      render(<VibeTags tags={tags} />);

      expect(screen.getByTestId("vibe-tag-cozy")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-quiet")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-spacious")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-lively")).toBeInTheDocument();

      expect(screen.queryByTestId("vibe-tag-focused")).not.toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tag-bright")).not.toBeInTheDocument();

      const moreBadge = screen.getByTestId("vibe-tags-more-badge");
      expect(moreBadge).toBeInTheDocument();
      expect(moreBadge).toHaveTextContent("+2 more");
    });

    it("respects custom maxDisplay prop when set to 2", () => {
      const tags = ["tag1", "tag2", "tag3", "tag4", "tag5"];
      render(<VibeTags tags={tags} maxDisplay={2} />);

      expect(screen.getByTestId("vibe-tag-tag1")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-tag2")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tag-tag3")).not.toBeInTheDocument();

      const moreBadge = screen.getByTestId("vibe-tags-more-badge");
      expect(moreBadge).toHaveTextContent("+3 more");
    });

    it("does not render overflow badge when total valid tags <= maxDisplay", () => {
      const tags = ["vibe1", "vibe2"];
      render(<VibeTags tags={tags} maxDisplay={4} />);

      expect(screen.getByTestId("vibe-tag-vibe1")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-vibe2")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tags-more-badge")).not.toBeInTheDocument();
    });

    it("handles maxDisplay set to 1 correctly", () => {
      const tags = ["first", "second", "third"];
      render(<VibeTags tags={tags} maxDisplay={1} />);

      expect(screen.getByTestId("vibe-tag-first")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tag-second")).not.toBeInTheDocument();

      const moreBadge = screen.getByTestId("vibe-tags-more-badge");
      expect(moreBadge).toHaveTextContent("+2 more");
    });
  });

  describe("Sizing & Custom Styling Props", () => {
    it("applies small size classes when size='sm'", () => {
      render(<VibeTags tags={["tag1"]} size="sm" />);

      const tag = screen.getByTestId("vibe-tag-tag1");
      expect(tag).toHaveClass("px-2");
      expect(tag).toHaveClass("text-[10px]");
    });

    it("applies medium size classes when size='md'", () => {
      render(<VibeTags tags={["tag1"]} size="md" />);

      const tag = screen.getByTestId("vibe-tag-tag1");
      expect(tag).toHaveClass("px-2.5");
      expect(tag).toHaveClass("text-xs");
    });

    it("applies large size classes when size='lg'", () => {
      render(<VibeTags tags={["tag1"]} size="lg" />);

      const tag = screen.getByTestId("vibe-tag-tag1");
      expect(tag).toHaveClass("px-3");
      expect(tag).toHaveClass("text-sm");
    });

    it("forwards custom className prop to container element", () => {
      render(<VibeTags tags={["cozy"]} className="custom-margin mt-4 shadow-md" />);

      const container = screen.getByTestId("vibe-tags-container");
      expect(container).toHaveClass("custom-margin");
      expect(container).toHaveClass("mt-4");
      expect(container).toHaveClass("shadow-md");
    });
  });

  describe("Venue Card Layout Collapsing Verification", () => {
    function MockVenueCard({ tags }: { tags?: string[] | null }) {
      return (
        <div data-testid="venue-card" className="p-4 border rounded-xl">
          <h3 data-testid="venue-name">Artisan Cafe</h3>
          <p data-testid="venue-address">123 Market St</p>
          <VibeTags tags={tags} className="mt-2" />
          <div data-testid="venue-footer">Footer Content</div>
        </div>
      );
    }

    it("collapses layout space seamlessly without empty wrapper DOM node when tags is empty array", () => {
      render(<MockVenueCard tags={[]} />);

      expect(screen.getByTestId("venue-card")).toBeInTheDocument();
      expect(screen.getByTestId("venue-name")).toBeInTheDocument();
      expect(screen.getByTestId("venue-footer")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tags-container")).not.toBeInTheDocument();
    });

    it("collapses layout space seamlessly when tags is undefined", () => {
      render(<MockVenueCard tags={undefined} />);

      expect(screen.getByTestId("venue-card")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tags-container")).not.toBeInTheDocument();
    });

    it("collapses layout space seamlessly when tags is null", () => {
      render(<MockVenueCard tags={null} />);

      expect(screen.getByTestId("venue-card")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tags-container")).not.toBeInTheDocument();
    });

    it("renders tags container inside venue card when tags are present", () => {
      render(<MockVenueCard tags={["cozy", "quiet"]} />);

      expect(screen.getByTestId("venue-card")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tags-container")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-cozy")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-quiet")).toBeInTheDocument();
    });
  });

  describe("Edge Case & Resilience Testing", () => {
    it("handles single-item tag lists properly", () => {
      render(<VibeTags tags={["solo"]} />);

      expect(screen.getByTestId("vibe-tags-container")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-solo")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tags-more-badge")).not.toBeInTheDocument();
    });

    it("handles duplicate tag names in input list gracefully", () => {
      render(<VibeTags tags={["cozy", "cozy", "quiet"]} />);

      expect(screen.getByTestId("vibe-tags-container")).toBeInTheDocument();
      const tags = screen.getAllByTestId("vibe-tag-cozy");
      expect(tags.length).toBe(2);
    });

    it("handles long multi-word tag names without breaking layout", () => {
      render(<VibeTags tags={["ultra quiet deep focus zone"]} />);

      const tag = screen.getByTestId("vibe-tag-ultra-quiet-deep-focus-zone");
      expect(tag).toBeInTheDocument();
      expect(tag).toHaveTextContent("ultra quiet deep focus zone");
    });
  });
});
