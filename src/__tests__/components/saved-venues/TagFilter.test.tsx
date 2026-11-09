import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TagFilter } from "@/components/saved-venues/TagFilter";
import type { FavoriteTag } from "@/hooks/useSavedVenues";

const MOCK_TAGS: FavoriteTag[] = [
  { id: "tag-1", name: "Quiet", color: "#22c55e" },
  { id: "tag-2", name: "Fast WiFi", color: "#3b82f6" },
  { id: "tag-3", name: "quiet", color: "#10b981" }, // Duplicate case-insensitive
  { id: "tag-4", name: "Coffee", color: "#f59e0b" },
];

describe("TagFilter", () => {
  const onToggleTag = jest.fn();
  const onClear = jest.fn();
  const onFilterChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders null when allTags is empty or undefined", () => {
    const { container: c1 } = render(
      <TagFilter
        allTags={[]}
        selectedTagIds={[]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <TagFilter
        allTags={undefined as unknown as FavoriteTag[]}
        selectedTagIds={[]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );
    expect(c2.firstChild).toBeNull();
  });

  it("renders button and deduplicates tags case-insensitively", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={[]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );

    const button = screen.getByTestId("tag-filter-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });

  it("handles undefined or non-array selectedTagIds gracefully", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={undefined as unknown as string[]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );

    expect(screen.getByTestId("tag-filter-button")).toBeInTheDocument();
  });

  it("opens dropdown and allows searching and filtering tags", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={["tag-1"]}
        onToggleTag={onToggleTag}
        onClear={onClear}
        onFilterChange={onFilterChange}
      />,
    );

    const button = screen.getByTestId("tag-filter-button");
    fireEvent.click(button);

    expect(screen.getByTestId("tag-filter-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("tag-filter-option-tag-1")).toBeInTheDocument();
    expect(screen.getByTestId("tag-filter-option-tag-2")).toBeInTheDocument();
    expect(screen.getByTestId("tag-filter-option-tag-4")).toBeInTheDocument();

    const searchInput = screen.getByTestId("tag-filter-search-input");
    fireEvent.change(searchInput, { target: { value: "wifi" } });

    expect(onFilterChange).toHaveBeenCalledWith("wifi");
    expect(screen.getByTestId("tag-filter-option-tag-2")).toBeInTheDocument();
    expect(screen.queryByTestId("tag-filter-option-tag-1")).not.toBeInTheDocument();

    // Clear search
    const clearSearchBtn = screen.getByTestId("tag-filter-search-clear");
    fireEvent.click(clearSearchBtn);
    expect(onFilterChange).toHaveBeenCalledWith("");
    expect(screen.getByTestId("tag-filter-option-tag-1")).toBeInTheDocument();
  });

  it("shows empty state when search matches no tags", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={[]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByTestId("tag-filter-button"));
    const searchInput = screen.getByTestId("tag-filter-search-input");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    expect(screen.getByTestId("tag-filter-empty")).toHaveTextContent("No tags found");
  });

  it("toggles tag on option click", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={[]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByTestId("tag-filter-button"));
    fireEvent.click(screen.getByTestId("tag-filter-option-tag-2"));

    expect(onToggleTag).toHaveBeenCalledWith("tag-2");
  });

  it("renders active chips and removes tag on chip remove button click", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={["tag-1", "tag-2"]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );

    expect(screen.getByTestId("tag-filter-count-badge")).toHaveTextContent("2");
    expect(screen.getByTestId("active-tag-chip-tag-1")).toBeInTheDocument();
    expect(screen.getByTestId("active-tag-chip-tag-2")).toBeInTheDocument();

    const removeBtn = screen.getByTestId("remove-active-tag-tag-1");
    fireEvent.click(removeBtn);
    expect(onToggleTag).toHaveBeenCalledWith("tag-1");
  });

  it("calls onClear when clear filters button is clicked in dropdown", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={["tag-1"]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByTestId("tag-filter-button"));
    const clearBtn = screen.getByTestId("tag-filter-clear-all");
    fireEvent.click(clearBtn);

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("closes dropdown on Escape key", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={[]}
        onToggleTag={onToggleTag}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByTestId("tag-filter-button"));
    expect(screen.getByTestId("tag-filter-dropdown")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("tag-filter-dropdown")).not.toBeInTheDocument();
  });

  it("closes dropdown when clicking outside", () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <TagFilter
          allTags={MOCK_TAGS}
          selectedTagIds={[]}
          onToggleTag={onToggleTag}
          onClear={onClear}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId("tag-filter-button"));
    expect(screen.getByTestId("tag-filter-dropdown")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("tag-filter-dropdown")).not.toBeInTheDocument();
  });

  it("merges custom className with container", () => {
    render(
      <TagFilter
        allTags={MOCK_TAGS}
        selectedTagIds={[]}
        onToggleTag={onToggleTag}
        onClear={onClear}
        className="custom-tag-filter-class"
      />,
    );

    expect(screen.getByTestId("tag-filter-container")).toHaveClass("custom-tag-filter-class");
  });
});
