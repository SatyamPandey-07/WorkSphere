import { render, screen } from "@testing-library/react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

describe("Breadcrumb", () => {
  it("renders nothing when items array is empty", () => {
    const { container } = render(<Breadcrumb items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a nav element with aria-label='Breadcrumb'", () => {
    render(<Breadcrumb items={[{ label: "Home" }]} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toBeInTheDocument();
  });

  it("renders the last item as current page (aria-current='page')", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Collections", href: "/collections" },
          { label: "My Collection" },
        ]}
      />,
    );
    const current = screen.getByText("My Collection");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("renders linked items as anchor tags", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Explore", href: "/ai" },
          { label: "Venue Name" },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "Explore" });
    expect(link).toHaveAttribute("href", "/ai");
  });

  it("last item is not a link", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Collections", href: "/collections" },
          { label: "My Collection" },
        ]}
      />,
    );
    const current = screen.getByText("My Collection");
    expect(current.tagName).not.toBe("A");
  });

  it("renders the Home icon when showHomeIcon=true (default)", () => {
    const { container } = render(
      <Breadcrumb items={[{ label: "Page" }]} showHomeIcon />,
    );
    const homeLink = container.querySelector('a[aria-label="Home"]');
    expect(homeLink).toBeInTheDocument();
  });

  it("does not render Home icon when showHomeIcon=false", () => {
    const { container } = render(
      <Breadcrumb items={[{ label: "Page" }]} showHomeIcon={false} />,
    );
    expect(container.querySelector('[aria-label="Home"]')).toBeNull();
  });

  it("renders all items in order", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Step 1", href: "/step1" },
          { label: "Step 2", href: "/step2" },
          { label: "Step 3" },
        ]}
      />,
    );
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByText("Step 3")).toBeInTheDocument();
  });
});
