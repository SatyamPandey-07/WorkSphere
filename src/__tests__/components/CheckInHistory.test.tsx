import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInHistory } from "@/app/dashboard/CheckInHistory";

// Mock URL API for CSV export
global.URL.createObjectURL = jest.fn(() => "blob:mock");
global.URL.revokeObjectURL = jest.fn();

describe("CheckInHistory", () => {
  it("renders the 'Check-In History' heading", () => {
    render(<CheckInHistory />);
    expect(screen.getByText("Check-In History")).toBeInTheDocument();
  });

  it("shows the number of recent check-ins", () => {
    render(<CheckInHistory />);
    expect(screen.getByText(/Recent/)).toBeInTheDocument();
  });

  it("renders the Export JSON button", () => {
    render(<CheckInHistory />);
    expect(
      screen.getByRole("button", { name: /export.*json/i }),
    ).toBeInTheDocument();
  });

  it("renders check-in location names", () => {
    render(<CheckInHistory />);
    // The mock data includes "The Roasted Bean Cafe"
    expect(screen.getByText(/Roasted Bean/i)).toBeInTheDocument();
  });

  it("triggers JSON download when Export JSON is clicked", async () => {
    const user = userEvent.setup();
    render(<CheckInHistory />);

    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const button = screen.getByRole("button", { name: /export.*json/i });
    await user.click(button);

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
