import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CustomAvatarUpload } from "@/components/CustomAvatarUpload";

const mockSetProfileImage = jest.fn();
const mockReload = jest.fn();

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: true,
    user: {
      id: "user_test_123",
      fullName: "Jane Nomad",
      hasImage: true,
      imageUrl: "https://example.com/avatar.jpg",
      setProfileImage: mockSetProfileImage,
      reload: mockReload,
    },
  }),
}));

jest.mock("@/lib/exifOrientation", () => ({
  normalizeImageOrientation: jest.fn((file: File) => Promise.resolve(file)),
}));

describe("CustomAvatarUpload Component EXIF Orientation & Preview (#1332)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.URL.createObjectURL = jest
      .fn()
      .mockReturnValue("blob:http://localhost/upright-preview");
    global.URL.revokeObjectURL = jest.fn();
    mockSetProfileImage.mockResolvedValue({
      imageUrl: "https://example.com/new-upright-avatar.jpg",
    });
    mockReload.mockResolvedValue(undefined);
  });

  it("renders profile picture section with image-orientation style", () => {
    render(<CustomAvatarUpload />);

    expect(screen.getByText("Profile Picture")).toBeInTheDocument();
    const avatarImg = screen.getByRole("img", { name: "Jane Nomad" });
    expect(avatarImg).toBeInTheDocument();
    expect(avatarImg).toHaveStyle("image-orientation: from-image");
  });

  it("normalizes EXIF orientation and updates preview on camera photo upload", async () => {
    render(<CustomAvatarUpload />);

    const fileInput = screen.getByTestId("file-input");
    expect(fileInput).toBeInTheDocument();

    const smartphonePhoto = new File(["photo-bytes"], "camera_portrait.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(fileInput!, {
      target: { files: [smartphonePhoto] },
    });

    await waitFor(() => {
      expect(mockSetProfileImage).toHaveBeenCalled();
      expect(mockReload).toHaveBeenCalled();
    });
  });
});
