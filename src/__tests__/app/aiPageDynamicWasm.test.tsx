import fs from "fs";
import path from "path";

describe("Next.js App Router - /ai Page WebAssembly & Client Dynamic Import Guard", () => {
  it("isolates EnhancedChatbot inside dynamic import with ssr: false to prevent hydration mismatches", () => {
    const filePath = path.join(process.cwd(), "src/app/ai/page.tsx");
    const content = fs.readFileSync(filePath, "utf-8");

    // Verify static import is not used for EnhancedChatbot
    expect(content).not.toMatch(
      /^import\s+\{\s*EnhancedChatbot\s*\}\s+from\s+["']@\/components\/EnhancedChatbot["']/m,
    );

    // Verify dynamic import with ssr: false is present for EnhancedChatbot
    expect(content).toMatch(/const\s+EnhancedChatbot\s*=\s*dynamic\s*\(/);
    expect(content).toMatch(/import\(["']@\/components\/EnhancedChatbot["']\)/);
    expect(content).toMatch(/ssr:\s*false/);
  });
});
