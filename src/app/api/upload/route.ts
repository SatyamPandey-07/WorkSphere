import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { auth } from "@clerk/nextjs/server";
import fs from "fs";
import path from "path";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file size (max 5MB)
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds 5MB limit" },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Validate file type via magic bytes (not client-controlled MIME)
    const magicBytes: Record<string, [number, number[]][]> = {
      png: [[0, [0x89, 0x50, 0x4e, 0x47]]],
      jpeg: [[0, [0xff, 0xd8]]],
      gif: [[0, [0x47, 0x49, 0x46]]],
      webp: [[8, [0x57, 0x45, 0x42, 0x50]]],
    };
    const detected = Object.entries(magicBytes).find(([_, sigs]) =>
      sigs.some(([offset, bytes]) =>
        bytes.every((b, i) => buffer[offset + i] === b),
      ),
    )?.[0];
    if (!detected || !["png", "jpeg", "gif", "webp"].includes(detected)) {
      return NextResponse.json(
        {
          error:
            "Invalid file type. Only PNG, JPEG, GIF, and WEBP images are allowed.",
        },
        { status: 400 },
      );
    }

    // Fallback to local storage if Cloudinary config is missing
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      process.env.CLOUDINARY_CLOUD_NAME === "dummy"
    ) {
      if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
        console.warn(
          "Warning: Using local storage fallback in a serverless environment. Uploaded files will not persist.",
        );
      }

      const uploadDir = path.join(process.cwd(), "public", "uploads");

      await fs.promises.mkdir(uploadDir, { recursive: true });

      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const filePath = path.join(uploadDir, fileName);
      await fs.promises.writeFile(filePath, buffer);

      return NextResponse.json({ url: `/uploads/${fileName}` });
    }

    // Upload to Cloudinary using buffer stream
    const result: any = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { folder: "worksphere_venues" },
          (error: any, result: any) => {
            if (error) reject(error);
            else resolve(result);
          },
        )
        .end(buffer);
    });

    return NextResponse.json({ url: result.secure_url });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
