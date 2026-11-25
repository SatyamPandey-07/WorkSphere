import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import TriageDesk from "@/components/admin/TriageDesk";

describe("TriageDesk active filters", () => {
  test("renders no active filter chips at default values", () => {
    render(<TriageDesk />);

    expect(screen.queryByTestId("active-filters-bar")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear Filters" }),
    ).not.toBeInTheDocument();
  });

  test("shows a status chip for a non-default status", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "OPEN" },
    });

    expect(screen.getByTestId("status-filter-chip")).toHaveTextContent(
      "Status: Open",
    );
  });

  test("shows a severity chip for a non-default severity", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "CRITICAL" },
    });

    expect(screen.getByTestId("severity-filter-chip")).toHaveTextContent(
      "Severity: Critical",
    );
  });

  test("shows a category chip for a non-default category", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "WATER_SUPPLY" },
    });

    expect(screen.getByTestId("category-filter-chip")).toHaveTextContent(
      "Category: Water Supply",
    );
  });

  test("renders multiple active chips together", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "OPEN" },
    });
    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "SECURITY" },
    });
    fireEvent.change(screen.getByLabelText("Search tickets"), {
      target: { value: "login failure" },
    });

    expect(screen.getByTestId("status-filter-chip")).toBeInTheDocument();
    expect(screen.getByTestId("severity-filter-chip")).toBeInTheDocument();
    expect(screen.getByTestId("category-filter-chip")).toBeInTheDocument();
    expect(screen.getByTestId("search-filter-chip")).toBeInTheDocument();
  });

  test("removing a status chip resets only status", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "OPEN" },
    });
    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "MEDIUM" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Status filter" }),
    );

    expect(screen.getByLabelText("Status")).toHaveValue("ALL");
    expect(screen.getByLabelText("Severity")).toHaveValue("MEDIUM");
    expect(screen.queryByTestId("status-filter-chip")).not.toBeInTheDocument();
  });

  test("removing one chip keeps other filters unchanged", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "OPEN" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "ELECTRICAL" },
    });
    fireEvent.change(screen.getByLabelText("Search tickets"), {
      target: { value: "street light" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Category filter" }),
    );

    expect(screen.getByLabelText("Category")).toHaveValue("ALL");
    expect(screen.getByLabelText("Status")).toHaveValue("OPEN");
    expect(screen.getByLabelText("Search tickets")).toHaveValue("street light");
  });

  test("Clear Filters resets every active filter and removes chips", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "OPEN" },
    });
    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "MEDIUM" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "ELECTRICAL" },
    });
    fireEvent.change(screen.getByLabelText("Search tickets"), {
      target: { value: "street" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));

    expect(screen.getByLabelText("Status")).toHaveValue("ALL");
    expect(screen.getByLabelText("Severity")).toHaveValue("ALL");
    expect(screen.getByLabelText("Category")).toHaveValue("ALL");
    expect(screen.getByLabelText("Search tickets")).toHaveValue("");
    expect(screen.queryByTestId("active-filters-bar")).not.toBeInTheDocument();
  });

  test("ticket results update after individual removal", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "MEDIUM" },
    });

    expect(
      screen.queryByTestId("triage-ticket-CMP-101"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("triage-ticket-CMP-102")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Severity filter" }),
    );

    expect(screen.getByTestId("triage-ticket-CMP-101")).toBeInTheDocument();
    expect(screen.getByTestId("triage-ticket-CMP-102")).toBeInTheDocument();
  });

  test("search filtering updates ticket results", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Search tickets"), {
      target: { value: "street light" },
    });

    expect(screen.getByTestId("triage-ticket-CMP-102")).toBeInTheDocument();
    expect(
      screen.queryByTestId("triage-ticket-CMP-101"),
    ).not.toBeInTheDocument();
  });

  test("Clear Filters is safe when no filters are active", () => {
    render(<TriageDesk />);

    expect(
      screen.queryByRole("button", { name: "Clear Filters" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("triage-ticket-CMP-101")).toBeInTheDocument();
    expect(screen.getByTestId("triage-ticket-CMP-102")).toBeInTheDocument();
  });

  test("filtered results show an empty state and clear restores tickets", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "SECURITY" },
    });

    expect(screen.getByTestId("triage-desk-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));

    expect(screen.queryByTestId("triage-desk-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("triage-ticket-CMP-101")).toBeInTheDocument();
    expect(screen.getByTestId("triage-ticket-CMP-102")).toBeInTheDocument();
  });

  test("individual severity dismissal preserves status and category", () => {
    render(<TriageDesk />);

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "OPEN" },
    });
    fireEvent.change(screen.getByLabelText("Severity"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "ELECTRICAL" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Severity filter" }),
    );

    expect(screen.getByLabelText("Severity")).toHaveValue("ALL");
    expect(screen.getByLabelText("Status")).toHaveValue("OPEN");
    expect(screen.getByLabelText("Category")).toHaveValue("ELECTRICAL");
  });
});
