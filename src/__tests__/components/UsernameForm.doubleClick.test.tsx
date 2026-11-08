import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UsernameForm } from "@/components/profile/UsernameForm";

describe("UsernameForm double submission prevention", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("disables the button, shows Saving..., and prevents duplicate submissions when clicked rapidly", async () => {
    let resolveFetch: (value: any) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    (global.fetch as jest.Mock).mockReturnValue(fetchPromise);

    const onSaveSuccess = jest.fn();

    render(
      <UsernameForm
        initialUsername="cooluser"
        onSaveSuccess={onSaveSuccess}
      />,
    );

    const input = screen.getByRole("textbox", { name: /username/i });
    fireEvent.change(input, { target: { value: "newcooluser" } });

    const submitBtn = screen.getByTestId("save-username-btn");
    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn).toHaveTextContent("Save Username");

    // Click multiple times rapidly
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    // Only one fetch call should be made
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Button should be disabled and show Saving...
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute("aria-busy", "true");
    expect(submitBtn).toHaveTextContent("Saving...");

    // Resolve the in-flight request
    resolveFetch!({
      ok: true,
      json: async () => ({
        success: true,
        data: { username: "newcooluser" },
      }),
    });

    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
      expect(submitBtn).toHaveAttribute("aria-busy", "false");
      expect(submitBtn).toHaveTextContent("Save Username");
      expect(onSaveSuccess).toHaveBeenCalledWith("newcooluser");
    });
  });
});
