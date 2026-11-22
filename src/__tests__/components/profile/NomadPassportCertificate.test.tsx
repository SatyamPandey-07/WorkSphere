import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NomadPassportCertificate } from "@/components/profile/NomadPassportCertificate";
import { downloadSVG } from "@/lib/qr/svgQr";

jest.mock("@/lib/qr/svgQr", () => ({
  downloadSVG: jest.fn(),
}));

const props = {
  displayName: "Alex Nomad",
  rank: "Veteran",
  verifiedCheckIns: 12,
  issuedAt: "2026-11-22T11:17:00.000Z",
};

describe("NomadPassportCertificate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders a preview image and a Download Badge button", () => {
    render(<NomadPassportCertificate {...props} />);
    const img = screen.getByTestId("nomad-badge-preview") as HTMLImageElement;
    expect(img.src.startsWith("data:image/svg+xml")).toBe(true);
    expect(
      screen.getByRole("button", { name: /download badge/i }),
    ).toBeEnabled();
  });

  it("downloads the badge on click", () => {
    render(<NomadPassportCertificate {...props} />);
    fireEvent.click(screen.getByTestId("download-badge-button"));
    expect(downloadSVG).toHaveBeenCalledTimes(1);
    const [svg, filename] = (downloadSVG as jest.Mock).mock.calls[0];
    expect(svg).toContain("VETERAN");
    expect(filename).toBe("nomad-badge-alex-nomad.svg");
  });

  it("shows an error and disables the button for invalid input", () => {
    render(<NomadPassportCertificate {...props} verifiedCheckIns={-1} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("download-badge-button")).toBeDisabled();
    expect(screen.queryByTestId("nomad-badge-preview")).toBeNull();
  });
});
