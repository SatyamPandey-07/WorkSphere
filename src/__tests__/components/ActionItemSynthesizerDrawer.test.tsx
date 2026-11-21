import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ActionItemSynthesizerDrawer from "@/components/ai/ActionItemSynthesizerDrawer";
import type { ActionItem, SynthesisReport } from "@/core/agents/ActionItemSynthesizer";

function makeItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: "a1",
    task: "Ship the release",
    assignee: "alice",
    assigner: "bob",
    dueDate: "2026-12-01",
    priority: "HIGH",
    status: "PENDING",
    confidenceScore: 0.9,
    contextQuote: "",
    dependencies: [],
    ...overrides,
  };
}

function makeReport(overrides: Partial<SynthesisReport> = {}): SynthesisReport {
  return {
    meetingId: "mtg 42",
    title: "Weekly Sync",
    summary: "",
    totalItems: 2,
    assignedItems: [makeItem()],
    unassignedItems: [
      makeItem({ id: "a2", task: "Book a room", assignee: "UNASSIGNED", dueDate: undefined }),
    ],
    keyDecisions: [],
    criticalPath: [],
    ...overrides,
  };
}

describe("ActionItemSynthesizerDrawer", () => {
  const writeText = jest.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("renders both export actions and the item count", () => {
    render(<ActionItemSynthesizerDrawer report={makeReport()} />);
    expect(screen.getByTestId("action-item-copy-markdown")).toBeTruthy();
    expect(screen.getByTestId("action-item-export-markdown")).toBeTruthy();
    expect(screen.getByTestId("action-item-count-badge").textContent).toBe("2 items");
  });

  it("copies the markdown checklist and shows a success toast", async () => {
    writeText.mockResolvedValue(undefined);
    render(<ActionItemSynthesizerDrawer report={makeReport()} />);

    fireEvent.click(screen.getByTestId("action-item-copy-markdown"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      "- [ ] **Ship the release** (Assignee: @alice, Due: 2026-12-01)\n- [ ] **Book a room**\n",
    );
    await waitFor(() =>
      expect(screen.getByTestId("action-item-toast-text").textContent).toMatch(/copied/i),
    );
  });

  it("shows an error toast when the clipboard write fails", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<ActionItemSynthesizerDrawer report={makeReport()} />);

    fireEvent.click(screen.getByTestId("action-item-copy-markdown"));

    await waitFor(() =>
      expect(screen.getByTestId("action-item-toast-text").textContent).toMatch(/couldn't copy/i),
    );
  });

  it("downloads a .md file when exporting", async () => {
    const createObjectURL = jest.fn(() => "blob:mock");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<ActionItemSynthesizerDrawer report={makeReport()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("action-item-export-markdown"));
    });

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    clickSpy.mockRestore();
  });

  it("disables both actions when there are no items", () => {
    render(
      <ActionItemSynthesizerDrawer
        report={makeReport({ assignedItems: [], unassignedItems: [], totalItems: 0 })}
      />,
    );
    expect(
      (screen.getByTestId("action-item-copy-markdown") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("action-item-export-markdown") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("action-item-empty")).toBeTruthy();
  });
});
