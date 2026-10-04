import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthlySpendingChart } from "@/app/dashboard/MonthlySpendingChart";

// Mock URL.createObjectURL and URL.revokeObjectURL for the CSV export
global.URL.createObjectURL = jest.fn(() => "blob:mock");
global.URL.revokeObjectURL = jest.fn();

describe("MonthlySpendingChart", () => {
  it("renders the 'Monthly Spending' heading", () => {
    render(<MonthlySpendingChart />);
    expect(screen.getByText("Monthly Spending")).toBeInTheDocument();
  });

  it("renders the 'Export CSV' button", () => {
    render(<MonthlySpendingChart />);
    expect(
      screen.getByRole("button", { name: /export.*csv/i }),
    ).toBeInTheDocument();
  });

  it("renders the year-to-date summary card", () => {
    render(<MonthlySpendingChart />);
    expect(screen.getByText(/year-to-date/i)).toBeInTheDocument();
  });

  it("renders an SVG chart element", () => {
    const { container } = render(<MonthlySpendingChart />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders month labels (Jan through Dec)", () => {
    render(<MonthlySpendingChart />);
    expect(screen.getByText("Jan")).toBeInTheDocument();
    expect(screen.getByText("Dec")).toBeInTheDocument();
  });

  it("renders the spending amount as $ value", () => {
    render(<MonthlySpendingChart />);
    // YTD total should be a $ prefixed number
    const totalEl = document.querySelector("p.text-2xl");
    expect(totalEl?.textContent).toMatch(/\$/);
  });

  it("clicking Export CSV triggers a blob download", async () => {
    const user = userEvent.setup();
    render(<MonthlySpendingChart />);

    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const button = screen.getByRole("button", { name: /export.*csv/i });
    await user.click(button);

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
