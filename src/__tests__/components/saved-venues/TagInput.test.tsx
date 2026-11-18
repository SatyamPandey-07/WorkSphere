import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TagInput, TAG_COLORS } from "@/components/saved-venues/TagInput";

describe("TagInput Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders trigger button initially in closed state with correct accessibility attributes", () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<TagInput onAdd={onAdd} />);

    const trigger = screen.getByTestId("tag-input-trigger-btn");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-label", "Add new tag");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Add Tag")).toBeInTheDocument();
    expect(screen.queryByTestId("tag-input-dialog")).not.toBeInTheDocument();
  });

  it("opens dialog on clicking trigger button and displays form inputs", () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<TagInput onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));

    const dialog = screen.getByTestId("tag-input-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-label", "Add tag");

    const input = screen.getByTestId("tag-input-name-field");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "Tag name...");

    const submitBtn = screen.getByTestId("tag-input-submit-btn");
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toBeDisabled(); // Disabled because name is empty
  });

  it("submits tag on clicking confirm button with trimmed name and default color", async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<TagInput onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));
    const input = screen.getByTestId("tag-input-name-field");
    fireEvent.change(input, { target: { value: "  Focus Room  " } });

    const submitBtn = screen.getByTestId("tag-input-submit-btn");
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith("Focus Room", TAG_COLORS[0].value);
    });

    // Dialog closes and returns to trigger button
    await waitFor(() => {
      expect(screen.queryByTestId("tag-input-dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("tag-input-trigger-btn")).toBeInTheDocument();
    });
  });

  it("submits tag when pressing Enter key in the input field", async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<TagInput onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));
    const input = screen.getByTestId("tag-input-name-field");
    fireEvent.change(input, { target: { value: "Quiet Area" } });

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith("Quiet Area", TAG_COLORS[0].value);
    });
  });

  it("allows selecting a custom color from the color radio group", async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<TagInput onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));

    // Select 'Purple' color
    const purpleBtn = screen.getByTestId("tag-color-btn-purple");
    fireEvent.click(purpleBtn);
    expect(purpleBtn).toHaveAttribute("aria-checked", "true");

    const input = screen.getByTestId("tag-input-name-field");
    fireEvent.change(input, { target: { value: "Favorite Spot" } });

    const submitBtn = screen.getByTestId("tag-input-submit-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith("Favorite Spot", "#a855f7");
    });
  });

  it("detects duplicate tags case-insensitively and disables submission", () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(
      <TagInput onAdd={onAdd} existingNames={["Silent Pod", "Cafeteria"]} />,
    );

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));
    const input = screen.getByTestId("tag-input-name-field");

    // Type duplicate with different casing and whitespace
    fireEvent.change(input, { target: { value: "  silent pod  " } });

    const errorMsg = screen.getByTestId("tag-duplicate-error");
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveTextContent("Tag already exists");

    const submitBtn = screen.getByTestId("tag-input-submit-btn");
    expect(submitBtn).toBeDisabled();

    // Type non-duplicate
    fireEvent.change(input, { target: { value: "Phone Booth" } });
    expect(screen.queryByTestId("tag-duplicate-error")).not.toBeInTheDocument();
    expect(submitBtn).not.toBeDisabled();
  });

  it("handles null and undefined existingNames gracefully", () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<TagInput onAdd={onAdd} existingNames={null as any} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));
    const input = screen.getByTestId("tag-input-name-field");
    fireEvent.change(input, { target: { value: "Terrace" } });

    expect(screen.queryByTestId("tag-duplicate-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("tag-input-submit-btn")).not.toBeDisabled();
  });

  it("displays server error message when onAdd rejects", async () => {
    const onAdd = jest.fn().mockRejectedValue(new Error("Network timeout"));
    render(<TagInput onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));
    const input = screen.getByTestId("tag-input-name-field");
    fireEvent.change(input, { target: { value: "New Desk" } });

    fireEvent.click(screen.getByTestId("tag-input-submit-btn"));

    await waitFor(() => {
      const errorEl = screen.getByTestId("tag-error");
      expect(errorEl).toBeInTheDocument();
      expect(errorEl).toHaveTextContent("Network timeout");
    });

    // Dialog stays open so user can retry
    expect(screen.getByTestId("tag-input-dialog")).toBeInTheDocument();
  });

  it("dismisses dialog on clicking cancel button", () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<TagInput onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));
    expect(screen.getByTestId("tag-input-dialog")).toBeInTheDocument();

    const cancelBtn = screen.getByTestId("tag-input-cancel-btn");
    fireEvent.click(cancelBtn);

    expect(screen.queryByTestId("tag-input-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("tag-input-trigger-btn")).toBeInTheDocument();
  });

  it("dismisses dialog on pressing Escape key", () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<TagInput onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));
    const dialog = screen.getByTestId("tag-input-dialog");
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByTestId("tag-input-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("tag-input-trigger-btn")).toBeInTheDocument();
  });

  it("prevents state update warnings when unmounted during in-flight submission", async () => {
    let resolvePromise: () => void = () => {};
    const pendingPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const onAdd = jest.fn().mockReturnValue(pendingPromise);

    const { unmount } = render(<TagInput onAdd={onAdd} />);

    fireEvent.click(screen.getByTestId("tag-input-trigger-btn"));
    const input = screen.getByTestId("tag-input-name-field");
    fireEvent.change(input, { target: { value: "Async Tag" } });

    fireEvent.click(screen.getByTestId("tag-input-submit-btn"));
    expect(screen.getByTestId("tag-input-submit-btn")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    // Unmount before promise resolves
    unmount();

    // Resolve now
    resolvePromise();
    await pendingPromise;
    // No error or warning thrown
  });
});
