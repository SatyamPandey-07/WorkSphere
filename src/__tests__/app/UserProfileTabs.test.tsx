import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import UserProfilePage, {
  UserProfileContent,
  PROFILE_TAB_CONFIG,
} from "@/app/user-profile/[[...user-profile]]/page";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => "/user-profile",
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@clerk/nextjs", () => ({
  UserProfile: () => <div data-testid="clerk-user-profile">Clerk UserProfile</div>,
}));

jest.mock("@/components/CustomAvatarUpload", () => ({
  CustomAvatarUpload: () => <div data-testid="custom-avatar-upload">Avatar Upload</div>,
}));

jest.mock("@/components/auth/PasskeyManager", () => ({
  PasskeyManager: () => <div data-testid="passkey-manager">Passkey Manager</div>,
}));

jest.mock("@/components/AccentPicker", () => ({
  AccentPicker: () => <div data-testid="accent-picker">Accent Picker</div>,
}));

jest.mock("@/components/profile/VisitedVenuesCard", () => ({
  VisitedVenuesCard: () => <div data-testid="visited-venues-card">Visited Venues</div>,
}));

describe("User Profile Tab Query Param Synchronization (#3466)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  describe("Initial Tab State from URL Query Param", () => {
    it("defaults to 'bookings' tab when no query parameter is present", () => {
      mockSearchParams = new URLSearchParams("");
      render(<UserProfilePage />);

      const bookingsTab = screen.getByTestId("tab-bookings");
      expect(bookingsTab).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tabpanel-bookings")).toBeInTheDocument();
      expect(screen.getByTestId("visited-venues-card")).toBeInTheDocument();
    });

    it("reads ?tab=security and renders Security panel directly (deep-linking)", () => {
      mockSearchParams = new URLSearchParams("tab=security");
      render(<UserProfilePage />);

      const securityTab = screen.getByTestId("tab-security");
      expect(securityTab).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tabpanel-security")).toBeInTheDocument();
      expect(screen.getByTestId("passkey-manager")).toBeInTheDocument();
    });

    it("reads ?tab=favorites and renders Favorites panel directly", () => {
      mockSearchParams = new URLSearchParams("tab=favorites");
      render(<UserProfilePage />);

      const favoritesTab = screen.getByTestId("tab-favorites");
      expect(favoritesTab).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tabpanel-favorites")).toBeInTheDocument();
    });

    it("reads ?tab=settings and renders Settings panel directly", () => {
      mockSearchParams = new URLSearchParams("tab=settings");
      render(<UserProfilePage />);

      const settingsTab = screen.getByTestId("tab-settings");
      expect(settingsTab).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tabpanel-settings")).toBeInTheDocument();
      expect(screen.getByTestId("custom-avatar-upload")).toBeInTheDocument();
      expect(screen.getByTestId("accent-picker")).toBeInTheDocument();
      expect(screen.getByTestId("clerk-user-profile")).toBeInTheDocument();
    });

    it("falls back to 'bookings' tab when an invalid query param is supplied", () => {
      mockSearchParams = new URLSearchParams("tab=unknown_random_tab");
      render(<UserProfilePage />);

      const bookingsTab = screen.getByTestId("tab-bookings");
      expect(bookingsTab).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tabpanel-bookings")).toBeInTheDocument();
    });
  });

  describe("Tab Switching & URL Synchronization", () => {
    it("updates URL with router.push when switching to Security tab", () => {
      mockSearchParams = new URLSearchParams("tab=bookings");
      render(<UserProfileContent />);

      const securityTab = screen.getByTestId("tab-security");
      fireEvent.click(securityTab);

      expect(mockPush).toHaveBeenCalledWith("/user-profile?tab=security", { scroll: false });
    });

    it("updates URL with router.push when switching to Favorites tab", () => {
      mockSearchParams = new URLSearchParams("tab=bookings");
      render(<UserProfileContent />);

      const favoritesTab = screen.getByTestId("tab-favorites");
      fireEvent.click(favoritesTab);

      expect(mockPush).toHaveBeenCalledWith("/user-profile?tab=favorites", { scroll: false });
    });

    it("updates URL with router.push when switching to Settings tab", () => {
      mockSearchParams = new URLSearchParams("tab=security");
      render(<UserProfileContent />);

      const settingsTab = screen.getByTestId("tab-settings");
      fireEvent.click(settingsTab);

      expect(mockPush).toHaveBeenCalledWith("/user-profile?tab=settings", { scroll: false });
    });

    it("uses router.replace if the user clicks the currently active tab", () => {
      mockSearchParams = new URLSearchParams("tab=security");
      render(<UserProfileContent />);

      const securityTab = screen.getByTestId("tab-security");
      fireEvent.click(securityTab);

      expect(mockReplace).toHaveBeenCalledWith("/user-profile?tab=security", { scroll: false });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("renders all four profile tabs in the tablist", () => {
      render(<UserProfilePage />);

      for (const config of PROFILE_TAB_CONFIG) {
        expect(screen.getByTestId(`tab-${config.id}`)).toBeInTheDocument();
        expect(screen.getByText(config.label)).toBeInTheDocument();
      }
    });
  });
});
