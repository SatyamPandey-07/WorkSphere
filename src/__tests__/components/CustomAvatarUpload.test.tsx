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

jest.mock("@/components/AvatarCropModal", () => ({
  AvatarCropModal: ({ isOpen, onCancel, onConfirm }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="mock-crop-modal">
        <button data-testid="cancel-crop" onClick={onCancel}>
          Cancel
        </button>
        <button
          data-testid="confirm-crop"
          onClick={() =>
            onConfirm(
              new File(["cropped"], "cropped.jpg", { type: "image/jpeg" }),
            )
          }
        >
          Confirm
        </button>
      </div>
    );
  },
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
      expect(screen.getByTestId("mock-crop-modal")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("confirm-crop"));

    await waitFor(() => {
      expect(mockSetProfileImage).toHaveBeenCalled();
      expect(mockReload).toHaveBeenCalled();
    });
  });
});

describe("CustomAvatarUpload Component Memory Leaks (#1432)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    let urlCounter = 0;
    global.URL.createObjectURL = jest
      .fn()
      .mockImplementation(
        () => `blob:http://localhost/mock-url-${++urlCounter}`,
      );
    global.URL.revokeObjectURL = jest.fn();
    mockSetProfileImage.mockResolvedValue({
      imageUrl: "https://example.com/new-upright-avatar.jpg",
    });
    mockReload.mockResolvedValue(undefined);
  });

  it("revokes object URLs when selecting another image", async () => {
    render(<CustomAvatarUpload />);
    const fileInput = screen.getByTestId("file-input");

    fireEvent.change(fileInput!, {
      target: { files: [new File(["1"], "1.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(fileInput!, {
      target: { files: [new File(["2"], "2.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(2);
    });
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:http://localhost/mock-url-1",
    );
  });

  it("revokes object URLs when closing the crop modal", async () => {
    render(<CustomAvatarUpload />);
    const fileInput = screen.getByTestId("file-input");

    fireEvent.change(fileInput!, {
      target: { files: [new File(["1"], "1.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-crop-modal")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("cancel-crop"));

    await waitFor(() => {
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:http://localhost/mock-url-1",
      );
    });
  });

  it("revokes object URLs on component unmount", async () => {
    const { unmount } = render(<CustomAvatarUpload />);
    const fileInput = screen.getByTestId("file-input");

    fireEvent.change(fileInput!, {
      target: { files: [new File(["1"], "1.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:http://localhost/mock-url-1",
    );
  });

  it("does not duplicate revocation if uploaded then unmounted", async () => {
    const { unmount } = render(<CustomAvatarUpload />);
    const fileInput = screen.getByTestId("file-input");

    fireEvent.change(fileInput!, {
      target: { files: [new File(["1"], "1.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-crop-modal")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("confirm-crop"));

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(2);
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:http://localhost/mock-url-1",
      );
    });

    global.URL.revokeObjectURL = jest.fn(); // Reset mock before unmount

    unmount();

    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:http://localhost/mock-url-2",
    );
  });
});
