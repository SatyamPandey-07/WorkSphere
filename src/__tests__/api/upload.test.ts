import { POST } from "@/app/api/upload/route";
import { auth } from "@clerk/nextjs/server";
import fs from "fs";

// Mock Clerk auth
jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

// Mock fs promises
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock Cloudinary
jest.mock("cloudinary", () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
    },
  },
}));

describe("Upload API", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return 401 if user is unauthorized", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const request = {
      formData: jest.fn(),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 400 if no file is provided", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "test-user-123",
    });

    const mockFormData = {
      get: jest.fn().mockReturnValue(null),
    };

    const request = {
      formData: jest.fn().mockResolvedValue(mockFormData),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("No file provided");
  });

  it("should return 400 if file size exceeds 5MB limit", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "test-user-123",
    });

    const mockFile = {
      name: "large_image.png",
      type: "image/png",
      size: 6 * 1024 * 1024, // 6MB
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    };

    const mockFormData = {
      get: jest.fn().mockReturnValue(mockFile),
    };

    const request = {
      formData: jest.fn().mockResolvedValue(mockFormData),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("size exceeds 5MB limit");
  });

  it("should return 400 if MIME type is invalid", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "test-user-123",
    });

    const mockFile = {
      name: "malicious.html",
      type: "text/html",
      size: 1024,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    };

    const mockFormData = {
      get: jest.fn().mockReturnValue(mockFile),
    };

    const request = {
      formData: jest.fn().mockResolvedValue(mockFormData),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid file type");
  });

  it("should return 400 if file extension is invalid", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "test-user-123",
    });

    const mockFile = {
      name: "malicious.exe",
      type: "image/png", // Spoofed MIME type
      size: 1024,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    };

    const mockFormData = {
      get: jest.fn().mockReturnValue(mockFile),
    };

    const request = {
      formData: jest.fn().mockResolvedValue(mockFormData),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid file extension");
  });

  it("should successfully upload and save locally if Cloudinary config is missing", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "test-user-123",
    });
    process.env.CLOUDINARY_CLOUD_NAME = "dummy";

    const fileContent = new TextEncoder().encode("fake image content");
    const mockFile = {
      name: "valid_image.png",
      type: "image/png",
      size: 1024,
      arrayBuffer: jest.fn().mockResolvedValue(fileContent.buffer),
    };

    const mockFormData = {
      get: jest.fn().mockReturnValue(mockFile),
    };

    const request = {
      formData: jest.fn().mockResolvedValue(mockFormData),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.url).toContain("/uploads/");
    expect(data.url).toContain("valid_image.png");

    expect(fs.promises.mkdir).toHaveBeenCalled();
    expect(fs.promises.writeFile).toHaveBeenCalled();
  });
});
