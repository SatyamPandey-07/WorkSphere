import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueGallery } from "@/components/venue/VenueGallery";

// Mock next/image (gallery photos)
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => {
    // Drop next/image-only boolean props that are invalid on a plain <img>
    const { fill, priority, ...imgProps } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imgProps} alt={props.alt} />;
  },
}));

const photos = ["https://example.com/venue-1.jpg"];

describe("VenueGallery photo attribution", () => {
  it("renders the photographer name as plain text, not a link, when photographerUrl is missing", () => {
    render(
      <VenueGallery
        photos={photos}
        attribution={{ photographer: "Asha Rao" }}
      />
    );

    const name = screen.getByText("Asha Rao");
    expect(name.tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("falls back to \"Verified Contributor\" as plain text when both photographer and photographerUrl are missing", () => {
    render(<VenueGallery photos={photos} attribution={{}} />);

    const fallback = screen.getByText("Verified Contributor");
    expect(fallback.tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("falls back to \"Verified Contributor\" when photographer is blank and photographerUrl is missing", () => {
    render(
      <VenueGallery
        photos={photos}
        attribution={{ photographer: "   " }}
      />
    );

    const fallback = screen.getByText("Verified Contributor");
    expect(fallback.tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links the photographer name to photographerUrl when it is provided", () => {
    render(
      <VenueGallery
        photos={photos}
        attribution={{
          photographer: "Asha Rao",
          photographerUrl: "https://example.com/asha",
        }}
      />
    );

    const link = screen.getByRole("link", { name: "Asha Rao" });
    expect(link).toHaveAttribute("href", "https://example.com/asha");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders no attribution footer when attribution is not provided", () => {
    render(<VenueGallery photos={photos} />);

    expect(screen.queryByText(/Photo by/)).not.toBeInTheDocument();
  });
});
