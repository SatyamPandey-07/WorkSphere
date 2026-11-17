import {
  buildMarkdownChecklist,
  formatActionItemAsMarkdown,
  formatAssignee,
  formatDueDate,
  toExportableActionItem,
} from "@/lib/ai/actionItemMarkdown";

describe("formatActionItemAsMarkdown", () => {
  it("formats a fully populated item", () => {
    expect(
      formatActionItemAsMarkdown({
        title: "Ship v2",
        description: "Final QA pass",
        assignee: "alice",
        dueDate: "2026-12-01",
      }),
    ).toBe("- [ ] **Ship v2**: Final QA pass (Assignee: @alice, Due: 2026-12-01)");
  });

  it("does not double the @ prefix", () => {
    expect(formatAssignee("@alice")).toBe("@alice");
  });

  it("omits the metadata block when assignee and due date are missing", () => {
    expect(formatActionItemAsMarkdown({ title: "Write notes", description: "Send recap" })).toBe(
      "- [ ] **Write notes**: Send recap",
    );
  });

  it("includes only the due date when unassigned", () => {
    expect(formatActionItemAsMarkdown({ title: "Review", dueDate: "2026-11-20" })).toBe(
      "- [ ] **Review** (Due: 2026-11-20)",
    );
  });

  it("includes only the assignee when there is no due date", () => {
    expect(formatActionItemAsMarkdown({ title: "Review", assignee: "bob", dueDate: null })).toBe(
      "- [ ] **Review** (Assignee: @bob)",
    );
  });

  it("treats blank assignee and invalid dates as unassigned", () => {
    expect(formatActionItemAsMarkdown({ title: "Task", assignee: "  ", dueDate: "not-a-date" })).toBe(
      "- [ ] **Task**",
    );
  });

  it("keeps display names with spaces without an @ prefix", () => {
    expect(formatAssignee("Alice Smith")).toBe("Alice Smith");
  });

  it("collapses newlines so each item stays on one line", () => {
    const out = formatActionItemAsMarkdown({ title: "A\nB", description: "line1\n\nline2" });
    expect(out).toBe("- [ ] **A B**: line1 line2");
    expect(out.includes("\n")).toBe(false);
  });

  it("escapes asterisks in titles", () => {
    expect(formatActionItemAsMarkdown({ title: "Fix **bug**" })).toBe("- [ ] **Fix \\*\\*bug\\*\\***");
  });

  it("renders completed items as checked", () => {
    expect(formatActionItemAsMarkdown({ title: "Done", completed: true })).toBe("- [x] **Done**");
  });
});

describe("formatDueDate", () => {
  it("normalizes Date objects and ISO strings to YYYY-MM-DD", () => {
    expect(formatDueDate(new Date("2026-11-20T10:00:00Z"))).toBe("2026-11-20");
    expect(formatDueDate("2026-11-20T23:59:00Z")).toBe("2026-11-20");
  });
  it("returns null for empty or invalid input", () => {
    expect(formatDueDate(undefined)).toBeNull();
    expect(formatDueDate("")).toBeNull();
    expect(formatDueDate("garbage")).toBeNull();
  });
});

describe("buildMarkdownChecklist", () => {
  it("returns an empty string for no items", () => {
    expect(buildMarkdownChecklist([])).toBe("");
  });
  it("joins items by newline and adds an optional heading", () => {
    const out = buildMarkdownChecklist([{ title: "One" }, { title: "Two" }], "Action Items");
    expect(out).toBe("## Action Items\n\n- [ ] **One**\n- [ ] **Two**\n");
  });
});

describe("toExportableActionItem", () => {
  const base = {
    id: "1",
    task: "Ship it",
    assignee: "alice",
    assigner: "bob",
    priority: "HIGH" as const,
    status: "PENDING" as const,
    confidenceScore: 1,
    contextQuote: "",
    dependencies: [],
  };

  it("maps the UNASSIGNED sentinel to no assignee", () => {
    const out = toExportableActionItem({ ...base, assignee: "UNASSIGNED" });
    expect(out.assignee).toBeNull();
    expect(formatActionItemAsMarkdown(out)).toBe("- [ ] **Ship it**");
  });

  it("marks COMPLETED items as checked and keeps the due date", () => {
    const out = toExportableActionItem({ ...base, status: "COMPLETED", dueDate: "2026-12-01" });
    expect(formatActionItemAsMarkdown(out)).toBe(
      "- [x] **Ship it** (Assignee: @alice, Due: 2026-12-01)",
    );
  });

  it("truncates long context quotes", () => {
    const out = toExportableActionItem({ ...base, contextQuote: "x".repeat(300) });
    expect(out.description?.length).toBe(140);
    expect(out.description?.endsWith("…")).toBe(true);
  });
});
