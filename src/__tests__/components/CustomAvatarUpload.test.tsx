import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  CustomAvatarUpload,
  AVATAR_PALETTE_COLORS,
  getAvatarInitials,
} from "@/components/CustomAvatarUpload";

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

function mockImageDimensions(width: number, height: number) {
  const ImageConstructorSpy = jest.fn().mockImplementation(() => {
    const img: Partial<HTMLImageElement> = {
      naturalWidth: width,
      naturalHeight: height,
      set src(_value: string) {
        setTimeout(() => {
          if (typeof this.onload === "function") {
            (this.onload as () => void)();
          }
        }, 0);
      },
    };
    return img;
  });
  (global as any).Image = ImageConstructorSpy;
  return ImageConstructorSpy;
}

describe("CustomAvatarUpload Component Image Dimension Validation (#1866)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.URL.createObjectURL = jest
      .fn()
      .mockReturnValue("blob:http://localhost/tiny-image");
    global.URL.revokeObjectURL = jest.fn();
  });

  it("shows error and does not open crop modal when image is below 100×100 px", async () => {
    mockImageDimensions(50, 50);
    render(<CustomAvatarUpload />);

    const fileInput = screen.getByTestId("file-input");
    const tinyImage = new File(["x"], "tiny.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [tinyImage] } });

    await waitFor(() => {
      expect(
        screen.getByText("Image resolution too low. Minimum 100×100 required."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByTestId("mock-crop-modal")).not.toBeInTheDocument();
  });

  it("shows error when only one dimension is below the minimum", async () => {
    mockImageDimensions(200, 60);
    render(<CustomAvatarUpload />);

    const fileInput = screen.getByTestId("file-input");
    const narrowImage = new File(["x"], "narrow.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [narrowImage] } });

    await waitFor(() => {
      expect(
        screen.getByText("Image resolution too low. Minimum 100×100 required."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByTestId("mock-crop-modal")).not.toBeInTheDocument();
  });

  it("opens crop modal when image meets the minimum 100×100 requirement", async () => {
    mockImageDimensions(100, 100);
    render(<CustomAvatarUpload />);

    const fileInput = screen.getByTestId("file-input");
    const validImage = new File(["x"], "valid.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [validImage] } });

    await waitFor(() => {
      expect(screen.getByTestId("mock-crop-modal")).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Image resolution too low. Minimum 100×100 required."),
    ).not.toBeInTheDocument();
  });
});

describe("CustomAvatarUpload Component EXIF Orientation & Preview (#1332)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockImageDimensions(200, 200);
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
    mockImageDimensions(200, 200);
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

describe("CustomAvatarUpload Component Avatar Preview Thumbnail & Actions (#4592)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockImageDimensions(200, 200);
    let urlCounter = 0;
    global.URL.createObjectURL = jest
      .fn()
      .mockImplementation(
        () => `blob:http://localhost/mock-preview-${++urlCounter}`,
      );
    global.URL.revokeObjectURL = jest.fn();
    mockSetProfileImage.mockResolvedValue({
      imageUrl: "https://example.com/new-avatar.jpg",
    });
    mockReload.mockResolvedValue(undefined);
  });

  it("generates a preview object URL on file input change and shows Change and Remove buttons", async () => {
    render(<CustomAvatarUpload />);
    const fileInput = screen.getByTestId("file-input");

    expect(
      screen.getByRole("button", { name: /upload image/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^change$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^remove$/i }),
    ).not.toBeInTheDocument();

    const sampleFile = new File(["sample"], "avatar.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, { target: { files: [sampleFile] } });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(sampleFile);
      expect(
        screen.getByRole("button", { name: /^change$/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^remove$/i }),
      ).toBeInTheDocument();
    });

    const previewImg = screen.getByRole("img", { name: "Jane Nomad" });
    expect(previewImg).toHaveAttribute(
      "src",
      "blob:http://localhost/mock-preview-1",
    );
  });

  it("revokes object URL and resets preview when Remove button is clicked", async () => {
    render(<CustomAvatarUpload />);
    const fileInput = screen.getByTestId("file-input");

    const sampleFile = new File(["sample"], "avatar.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, { target: { files: [sampleFile] } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^remove$/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:http://localhost/mock-preview-1",
    );
    expect(
      screen.queryByRole("button", { name: /^remove$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload image/i }),
    ).toBeInTheDocument();

    const avatarImg = screen.getByRole("img", { name: "Jane Nomad" });
    expect(avatarImg).toHaveAttribute("src", "https://example.com/avatar.jpg");
  });

  it("triggers file input click when Change button is clicked", async () => {
    render(<CustomAvatarUpload />);
    const fileInput = screen.getByTestId("file-input");
    const clickSpy = jest.spyOn(fileInput, "click");

    const sampleFile = new File(["sample"], "avatar.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, { target: { files: [sampleFile] } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^change$/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^change$/i }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("revokes preview object URL on component unmount", async () => {
    const { unmount } = render(<CustomAvatarUpload />);
    const fileInput = screen.getByTestId("file-input");

    const sampleFile = new File(["sample"], "avatar.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, { target: { files: [sampleFile] } });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:http://localhost/mock-preview-1",
    );
  });
});

describe("CustomAvatarUpload Component Avatar Color Palette Picker (#4821)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("provides 8 preset color swatch buttons in profile avatar settings", () => {
    render(<CustomAvatarUpload />);

    expect(screen.getByTestId("avatar-color-palette")).toBeInTheDocument();

    const expectedColors = [
      "indigo",
      "teal",
      "rose",
      "amber",
      "violet",
      "emerald",
      "sky",
      "fuchsia",
    ];

    expect(AVATAR_PALETTE_COLORS).toHaveLength(8);

    expectedColors.forEach((colorId) => {
      const swatch = screen.getByTestId(`color-swatch-${colorId}`);
      expect(swatch).toBeInTheDocument();
      expect(swatch).toHaveAttribute("data-color", colorId);
      expect(swatch.className).toContain(`bg-${colorId}-500`);
    });
  });

  it("displays selected color as avatar background when user has no custom photo", () => {
    render(<CustomAvatarUpload hasCustomPhoto={false} />);

    const initialsAvatar = screen.getByTestId("initials-avatar");
    expect(initialsAvatar).toBeInTheDocument();
    expect(initialsAvatar).toHaveTextContent("JN");
    expect(initialsAvatar.className).toContain("bg-indigo-500");

    // Click on 'rose' swatch
    const roseSwatch = screen.getByTestId("color-swatch-rose");
    fireEvent.click(roseSwatch);

    expect(initialsAvatar.className).toContain("bg-rose-500");
    expect(screen.getByTestId("avatar-display").className).toContain(
      "bg-rose-500",
    );
  });

  it("persists selected color choice to user settings in localStorage", () => {
    const onColorChange = jest.fn();
    render(
      <CustomAvatarUpload
        hasCustomPhoto={false}
        onColorChange={onColorChange}
      />,
    );

    const emeraldSwatch = screen.getByTestId("color-swatch-emerald");
    fireEvent.click(emeraldSwatch);

    expect(
      localStorage.getItem("worksphere_avatar_color_user_test_123"),
    ).toBe("emerald");
    expect(localStorage.getItem("worksphere_avatar_color")).toBe("emerald");
    expect(onColorChange).toHaveBeenCalledWith("emerald");

    const initialsAvatar = screen.getByTestId("initials-avatar");
    expect(initialsAvatar.className).toContain("bg-emerald-500");
  });

  it("loads previously persisted color from localStorage or initialColor prop", () => {
    localStorage.setItem("worksphere_avatar_color_user_test_123", "fuchsia");

    const { rerender } = render(<CustomAvatarUpload hasCustomPhoto={false} />);
    let initialsAvatar = screen.getByTestId("initials-avatar");
    expect(initialsAvatar.className).toContain("bg-fuchsia-500");

    rerender(
      <CustomAvatarUpload hasCustomPhoto={false} initialColor="amber" />,
    );
    initialsAvatar = screen.getByTestId("initials-avatar");
    expect(initialsAvatar.className).toContain("bg-amber-500");
  });

  it("derives initials correctly using getAvatarInitials helper", () => {
    expect(getAvatarInitials({ firstName: "John", lastName: "Doe" })).toBe(
      "JD",
    );
    expect(getAvatarInitials({ fullName: "Alice Wonder" })).toBe("AW");
    expect(getAvatarInitials({ fullName: "Single" })).toBe("SI");
    expect(getAvatarInitials(null)).toBe("WS");
  });
});

