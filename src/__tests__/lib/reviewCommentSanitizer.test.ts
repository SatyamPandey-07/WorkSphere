import { sanitizeReviewComment } from "@/lib/reviewCommentSanitizer";

describe("sanitizeReviewComment", () => {
  it("leaves ordinary text untouched", () => {
    const text = "Great WiFi, quiet. Didn't love the coffee - 4/5! #1 spot";
    expect(sanitizeReviewComment(text)).toBe(text);
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeReviewComment("")).toBe("");
    expect(sanitizeReviewComment("   \n  ")).toBe("");
    expect(sanitizeReviewComment(null)).toBe("");
    expect(sanitizeReviewComment(undefined)).toBe("");
  });

  it("removes an unclosed code fence but keeps the text", () => {
    expect(sanitizeReviewComment("Nice place\n```js\nconsole.log('hi')")).toBe(
      "Nice place\nconsole.log('hi')",
    );
  });

  it("removes inline code markers, including unclosed ones", () => {
    expect(sanitizeReviewComment("Use `fast` wifi")).toBe("Use fast wifi");
    expect(sanitizeReviewComment("Nice ```code and more")).toBe(
      "Nice code and more",
    );
  });

  it("turns markdown links and images into their text", () => {
    expect(
      sanitizeReviewComment("See [the menu](https://example.com/menu) now"),
    ).toBe("See the menu now");
    expect(sanitizeReviewComment("![photo](http://x.co/y.png) nice")).toBe(
      "photo nice",
    );
  });

  it("keeps an unclosed link as plain text", () => {
    expect(sanitizeReviewComment("Click [here](http://evil.com")).toBe(
      "Click [here](http://evil.com",
    );
  });

  it("strips HTML tags but keeps the words between them", () => {
    expect(sanitizeReviewComment("Great <script>alert(1)</script> place")).toBe(
      "Great alert(1) place",
    );
    expect(sanitizeReviewComment("<img src=x onerror=alert(1)> ok")).toBe("ok");
    expect(sanitizeReviewComment("a <b>bold</b> b")).toBe("a bold b");
  });

  it("does not mistake ordinary angle brackets for tags", () => {
    expect(sanitizeReviewComment("I <3 this place, rating > 4")).toBe(
      "I <3 this place, rating > 4",
    );
  });

  it("removes heading and blockquote markers at the start of a line", () => {
    expect(sanitizeReviewComment("# Title\nbody")).toBe("Title\nbody");
    expect(sanitizeReviewComment("> quoted text")).toBe("quoted text");
  });

  it("removes bold, underline and strikethrough markers", () => {
    expect(sanitizeReviewComment("**amazing** and __fast__ ~~slow~~")).toBe(
      "amazing and fast slow",
    );
  });

  it("keeps single asterisks and underscores", () => {
    expect(sanitizeReviewComment("5 * 3 and snake_case")).toBe(
      "5 * 3 and snake_case",
    );
  });

  it("drops control characters but keeps line breaks", () => {
    expect(sanitizeReviewComment("a\u0000b\u0007c\nd")).toBe("abc\nd");
  });

  it("normalises line endings, trailing spaces and blank lines", () => {
    expect(sanitizeReviewComment("a  \r\nb\n\n\n\n\nc")).toBe("a\nb\n\nc");
  });

  it("cleans a messy combined comment", () => {
    expect(
      sanitizeReviewComment(
        "# Review\n> **Great** [spot](http://x.co)\n```\nunclosed",
      ),
    ).toBe("Review\nGreat spot\nunclosed");
  });
});
