import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ToastProvider, useToast } from "@/components/ui/Toast";

function TestButton() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast("Test message", "success")}>
      Show Toast
    </button>
  );
}

function ErrorToastButton() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast("Error occurred", "error")}>
      Show Error
    </button>
  );
}

function ActionToastButton() {
  const { toast } = useToast();
  return (
    <button
      onClick={() =>
        toast("Undo?", "warning", { label: "Undo", onClick: jest.fn() })
      }
    >
      Show Action
    </button>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Toast pause-on-hover", () => {
  it("auto-dismisses after 4 seconds when not hovered", async () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    expect(screen.getByText("Test message")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("pauses dismissal on mouseenter and resumes on mouseleave", async () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    const toast = screen.getByText("Test message").closest("[role='status']")!;

    // Advance partway, then hover
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    fireEvent.mouseEnter(toast);

    // Advance past original 4s mark — should still be visible
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText("Test message")).toBeInTheDocument();

    // Leave hover, new 4s timer starts
    fireEvent.mouseLeave(toast);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("dismisses immediately when dismiss button is clicked", async () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    const dismissBtn = screen.getByLabelText("Dismiss notification");
    fireEvent.click(dismissBtn);

    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("renders success toast with correct icon color", async () => {
    render(
      <Wrapper>
        <TestButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Toast"));
    const icon = screen.getByText("Test message")
      .closest("[role='status']")!
      .querySelector(".text-green-500");
    expect(icon).toBeInTheDocument();
  });

  it("renders error toast with correct icon color", async () => {
    render(
      <Wrapper>
        <ErrorToastButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Error"));
    const icon = screen.getByText("Error occurred")
      .closest("[role='status']")!
      .querySelector(".text-red-500");
    expect(icon).toBeInTheDocument();
  });

  it("renders action button when action is provided", async () => {
    render(
      <Wrapper>
        <ActionToastButton />
      </Wrapper>,
    );

    fireEvent.click(screen.getByText("Show Action"));
    expect(screen.getByText("Undo")).toBeInTheDocument();
  });
});
