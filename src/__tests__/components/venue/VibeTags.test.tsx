import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultVibeTags, { VibeTags } from "@/components/venue/VibeTags";

describe("VibeTags Component", () => {
  describe("Exports", () => {
    it("exports VibeTags as both named and default export", () => {
      expect(DefaultVibeTags).toBe(VibeTags);
    });
  });

  describe("Null and Empty Guards", () => {
    it("returns null when tags is undefined", () => {
      const { container } = render(<VibeTags />);
      expect(container.firstChild).toBeNull();
    });

    it("returns null when tags is null", () => {
      const { container } = render(<VibeTags tags={null} />);
      expect(container.firstChild).toBeNull();
    });

    it("returns null when tags is an empty array", () => {
      const { container } = render(<VibeTags tags={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("returns null when tags contains only empty or whitespace strings", () => {
      const { container } = render(<VibeTags tags={["", "   ", "\t"]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Rendering & Slugs", () => {
    it("renders valid tags and filters out blank items", () => {
      render(<VibeTags tags={["cozy", "   ", "productive"]} />);

      expect(screen.getByTestId("vibe-tags-container")).toBeInTheDocument();
      expect(screen.getByText("cozy")).toBeInTheDocument();
      expect(screen.getByText("productive")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-cozy")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-productive")).toBeInTheDocument();
    });

    it("generates sanitized slug test IDs stripping special characters", () => {
      render(<VibeTags tags={["Super Quiet! & Fast"]} />);

      expect(screen.getByTestId("vibe-tag-super-quiet--fast")).toBeInTheDocument();
    });

    it("deduplicates test IDs when identical tags are provided", () => {
      render(<VibeTags tags={["lively", "lively", "lively"]} />);

      expect(screen.getByTestId("vibe-tag-lively")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-lively-1")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-lively-2")).toBeInTheDocument();
    });
  });

  describe("Overflow and maxDisplay", () => {
    const manyTags = ["focus", "coffee", "rooftop", "spacious", "natural light", "library quiet"];

    it("limits displayed tags to default maxDisplay (4) and shows overflow badge", () => {
      render(<VibeTags tags={manyTags} />);

      expect(screen.getByTestId("vibe-tag-focus")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-coffee")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-rooftop")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-spacious")).toBeInTheDocument();

      expect(screen.queryByTestId("vibe-tag-natural-light")).not.toBeInTheDocument();
      expect(screen.getByTestId("vibe-tags-more-badge")).toHaveTextContent("+2 more");
    });

    it("respects custom maxDisplay prop", () => {
      render(<VibeTags tags={manyTags} maxDisplay={2} />);

      expect(screen.getByTestId("vibe-tag-focus")).toBeInTheDocument();
      expect(screen.getByTestId("vibe-tag-coffee")).toBeInTheDocument();
      expect(screen.queryByTestId("vibe-tag-rooftop")).not.toBeInTheDocument();
      expect(screen.getByTestId("vibe-tags-more-badge")).toHaveTextContent("+4 more");
    });

    it("does not render overflow badge when tags length is within maxDisplay", () => {
      render(<VibeTags tags={["tag1", "tag2"]} maxDisplay={4} />);

      expect(screen.queryByTestId("vibe-tags-more-badge")).not.toBeInTheDocument();
    });
  });

  describe("Size Variants", () => {
    it("renders small size classes", () => {
      render(<VibeTags tags={["sunlit"]} size="sm" />);
      const tag = screen.getByTestId("vibe-tag-sunlit");
      expect(tag).toHaveClass("text-[10px]");
    });

    it("renders medium size classes by default", () => {
      render(<VibeTags tags={["sunlit"]} />);
      const tag = screen.getByTestId("vibe-tag-sunlit");
      expect(tag).toHaveClass("text-xs");
    });

    it("renders large size classes", () => {
      render(<VibeTags tags={["sunlit"]} size="lg" />);
      const tag = screen.getByTestId("vibe-tag-sunlit");
      expect(tag).toHaveClass("text-sm");
    });
  });

  describe("Custom Props & Test IDs", () => {
    it("applies custom className and custom data-testid", () => {
      render(
        <VibeTags
          tags={["chic"]}
          className="my-vibe-container"
          data-testid="custom-vibe-test-id"
        />
      );

      const container = screen.getByTestId("custom-vibe-test-id");
      expect(container).toBeInTheDocument();
      expect(container).toHaveClass("my-vibe-container");
    });
  });
});
