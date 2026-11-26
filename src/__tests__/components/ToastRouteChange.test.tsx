import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ToastProvider, useToast } from "@/components/ui/Toast";

let mockPathname = "/dashboard";
const mockRouterPush = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock("lucide-react", () => ({
  X: (props: any) => <svg {...props} />,
  CheckCircle2: (props: any) => <svg {...props} />,
  AlertCircle: (props: any) => <svg {...props} />,
  AlertTriangle: (props: any) => <svg {...props} />,
  Info: (props: any) => <svg {...props} />,
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

function TestButtons() {
  const { toast } = useToast();

  return (
    <>
      <button onClick={() => toast("Temporary notification")}>
        Show temporary
      </button>
      <button
        onClick={() =>
          toast("Persistent notification", "error", {
            persistAcrossRoutes: true,
          })
        }
      >
        Show persistent
      </button>
    </>
  );
}

describe("Toast route changes", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
  });

  it("dismisses transient toasts when pathname changes", () => {
    const { rerender } = render(
      <ToastProvider>
        <TestButtons />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Show temporary"));
    expect(screen.getByText("Temporary notification")).toBeInTheDocument();

    act(() => {
      mockPathname = "/settings";
      rerender(
        <ToastProvider>
          <TestButtons />
        </ToastProvider>,
      );
    });

    expect(
      screen.queryByText("Temporary notification"),
    ).not.toBeInTheDocument();
  });

  it("preserves persistent toasts when pathname changes", () => {
    const { rerender } = render(
      <ToastProvider>
        <TestButtons />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Show persistent"));
    expect(screen.getByText("Persistent notification")).toBeInTheDocument();

    act(() => {
      mockPathname = "/venues";
      rerender(
        <ToastProvider>
          <TestButtons />
        </ToastProvider>,
      );
    });

    expect(screen.getByText("Persistent notification")).toBeInTheDocument();
  });
});
