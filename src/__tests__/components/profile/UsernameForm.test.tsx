import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UsernameFormDefault, {
  UsernameForm,
} from "@/components/profile/UsernameForm";

describe("UsernameForm Component Suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exports default component identical to named export", () => {
    expect(UsernameFormDefault).toBe(UsernameForm);
  });

  it("renders with default values and empty input when no initial username is provided", () => {
    render(<UsernameForm />);

    expect(screen.getByTestId("username-form")).toBeInTheDocument();
    const input = screen.getByTestId("username-input") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("");
    expect(screen.getByTestId("save-username-btn")).toBeInTheDocument();
  });

  it("pre-populates input when initialUsername is provided", () => {
    render(<UsernameForm initialUsername="existing_dev" />);

    const input = screen.getByTestId("username-input") as HTMLInputElement;
    expect(input.value).toBe("existing_dev");
  });

  it("updates input value on change", () => {
    render(<UsernameForm />);

    const input = screen.getByTestId("username-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new_alias" } });
    expect(input.value).toBe("new_alias");
  });

  it("validates empty input on submit and displays error", async () => {
    render(<UsernameForm />);

    const form = screen.getByTestId("username-form").querySelector("form");
    fireEvent.submit(form!);

    const error = await screen.findByTestId("username-error");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent("Username cannot be empty");
  });

  it("validates too short username (<3 chars) and displays minimum length error", async () => {
    render(<UsernameForm />);

    const input = screen.getByTestId("username-input");
    fireEvent.change(input, { target: { value: "ab" } });

    const form = screen.getByTestId("username-form").querySelector("form");
    fireEvent.submit(form!);

    const error = await screen.findByTestId("username-error");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent("Username must be at least 3 characters long");
  });

  it("clears error message when user corrects input to valid value", async () => {
    render(<UsernameForm />);

    const input = screen.getByTestId("username-input");
    fireEvent.change(input, { target: { value: "a" } });

    const form = screen.getByTestId("username-form").querySelector("form");
    fireEvent.submit(form!);

    expect(await screen.findByTestId("username-error")).toBeInTheDocument();

    // Type a valid username
    fireEvent.change(input, { target: { value: "valid_user" } });
    expect(screen.queryByTestId("username-error")).not.toBeInTheDocument();
  });

  it("successfully submits form, updates state, and calls onSaveSuccess", async () => {
    const handleSuccess = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<UsernameForm onSaveSuccess={handleSuccess} />);

    const input = screen.getByTestId("username-input");
    fireEvent.change(input, { target: { value: "nomad_coder" } });

    const submitBtn = screen.getByTestId("save-username-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nomad_coder" }),
      });
    });

    const successMsg = await screen.findByTestId("username-success");
    expect(successMsg).toHaveTextContent("Username updated successfully");
    expect(handleSuccess).toHaveBeenCalledWith("nomad_coder");
  });

  it("displays server error message when API responds with error status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Username already taken" }),
    });

    render(<UsernameForm />);

    const input = screen.getByTestId("username-input");
    fireEvent.change(input, { target: { value: "taken_user" } });

    const form = screen.getByTestId("username-form").querySelector("form");
    fireEvent.submit(form!);

    const error = await screen.findByTestId("username-error");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent("Username already taken");
  });

  it("displays network error message when fetch rejects", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network connection lost"));

    render(<UsernameForm />);

    const input = screen.getByTestId("username-input");
    fireEvent.change(input, { target: { value: "offline_user" } });

    const form = screen.getByTestId("username-form").querySelector("form");
    fireEvent.submit(form!);

    const error = await screen.findByTestId("username-error");
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent("Network connection lost");
  });

  it("safely handles unmount during in-flight network request", async () => {
    let resolvePromise: (val: unknown) => void;
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );

    const { unmount } = render(<UsernameForm />);

    const input = screen.getByTestId("username-input");
    fireEvent.change(input, { target: { value: "unmount_user" } });

    const form = screen.getByTestId("username-form").querySelector("form");
    fireEvent.submit(form!);

    // Unmount while request is active
    unmount();

    // Now resolve the promise
    resolvePromise!({
      ok: true,
      json: async () => ({ success: true }),
    });

    // Should complete cleanly without error
    await new Promise((r) => setTimeout(r, 10));
  });

  it("applies custom className and data-testid overrides", () => {
    render(
      <UsernameForm
        className="custom-form-styling"
        data-testid="custom-username-wrapper"
      />
    );

    const wrapper = screen.getByTestId("custom-username-wrapper");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.className).toContain("custom-form-styling");
  });
});
