import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TagChip } from "@/components/saved-venues/TagChip";

describe("TagChip", () => {
  it("renders tag name and color dot", () => {
    render(<TagChip name="Quiet Spot" color="#3b82f6" />);
    expect(screen.getByText("Quiet Spot")).toBeInTheDocument();
    expect(screen.getByLabelText("Tag: Quiet Spot")).toBeInTheDocument();
  });

  it("applies active styles when active prop is true with onClick", () => {
    const onClick = jest.fn();
    render(<TagChip name="Test" color="#3b82f6" active onClick={onClick} />);
    const chip = screen.getByLabelText("Tag: Test");
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("does not set aria-pressed without onClick", () => {
    render(<TagChip name="Test" color="#3b82f6" active />);
    const chip = screen.getByLabelText("Tag: Test");
    expect(chip).not.toHaveAttribute("aria-pressed");
  });

  it("calls onDelete when delete button is clicked", () => {
    const onDelete = jest.fn();
    render(<TagChip name="Test" color="#3b82f6" onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Remove tag Test"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("calls onRename when rename button is clicked", () => {
    const onRename = jest.fn();
    render(<TagChip name="Test" color="#3b82f6" onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit tag Test"));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("calls onClick when chip is clicked", () => {
    const onClick = jest.fn();
    render(<TagChip name="Test" color="#3b82f6" onClick={onClick} />);
    fireEvent.click(screen.getByLabelText("Tag: Test"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard activation", () => {
    const onClick = jest.fn();
    render(<TagChip name="Test" color="#3b82f6" onClick={onClick} />);
    const chip = screen.getByLabelText("Tag: Test");
    fireEvent.keyDown(chip, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders in small size", () => {
    render(<TagChip name="Small" color="#22c55e" size="sm" />);
    const chip = screen.getByLabelText("Tag: Small");
    expect(chip).toBeInTheDocument();
  });

  it("does not render delete button when onDelete is not provided", () => {
    render(<TagChip name="Test" color="#3b82f6" />);
    expect(screen.queryByLabelText("Remove tag Test")).not.toBeInTheDocument();
  });
});
