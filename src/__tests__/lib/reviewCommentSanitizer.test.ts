import {
  sanitizeReviewComment,
  validateReviewComment,
  filterAllowedHtml,
  stripScriptAndEventHandlers,
  maskProfanity,
  stripControlCharacters,
  cleanControlCharacters,
  MIN_COMMENT_LENGTH,
  MAX_COMMENT_LENGTH,
} from "@/lib/reviewCommentSanitizer";

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

describe("Review Comment Sanitization & Moderation (#5045)", () => {
  describe("Allowed HTML Formatting Tags", () => {
    it("preserves allowed <b> and <i> tags", () => {
      const input = "This venue has <b>fast WiFi</b> and <i>comfortable seating</i>.";
      const sanitized = sanitizeReviewComment(input, { allowFormatting: true });
      expect(sanitized).toBe(
        "This venue has <b>fast WiFi</b> and <i>comfortable seating</i>."
      );
    });

    it("sanitizes safe anchor tags with https URLs and enforces rel/target attributes", () => {
      const input =
        'Check their speedtest at <a href="https://fast.com">SpeedTest</a>.';
      const sanitized = sanitizeReviewComment(input, { allowFormatting: true });
      expect(sanitized).toBe(
        'Check their speedtest at <a href="https://fast.com" target="_blank" rel="noopener noreferrer">SpeedTest</a>.'
      );
    });

    it("strips disallowed HTML tags like <div>, <span>, <img>, and <button> while retaining text", () => {
      const input =
        '<div>Great cafe! <span>Quiet corner.</span> <img src="pic.jpg"/></div>';
      const sanitized = sanitizeReviewComment(input, { allowFormatting: true });
      expect(sanitized).toBe("Great cafe! Quiet corner.");
    });
  });

  describe("Script Tag and Inline Event Handler Stripping", () => {
    it("strips <script> tags and enclosed executable code completely", () => {
      const input =
        'Awesome coffee!<script>alert("XSS Attack!");</script> Highly recommended.';
      const sanitized = sanitizeReviewComment(input, { allowFormatting: true });
      expect(sanitized).not.toContain("<script>");
      expect(sanitized).not.toContain("alert");
      expect(sanitized).toBe("Awesome coffee! Highly recommended.");
    });

    it("strips dangerous inline DOM event handlers (onerror, onload, onclick)", () => {
      const input =
        '<b onclick="stealTokens()">Bold text</b> <img src=x onerror="fetchMalicious()"/>';
      const sanitized = sanitizeReviewComment(input, { allowFormatting: true });
      expect(sanitized).not.toContain("onclick");
      expect(sanitized).not.toContain("onerror");
      expect(sanitized).not.toContain("stealTokens");
      expect(sanitized).toBe("<b>Bold text</b>");
    });

    it("disallows javascript: URI schemes in href attributes", () => {
      const input =
        '<a href="javascript:alert(document.cookie)">Malicious Link</a>';
      const sanitized = sanitizeReviewComment(input, { allowFormatting: true });
      expect(sanitized).not.toContain("javascript:");
      expect(sanitized).toBe("Malicious Link");
    });
  });

  describe("Profanity Masking Rules", () => {
    it("masks recognized prohibited terms with asterisks matching term length", () => {
      const input = "The manager was a complete asshole and the service was shit.";
      const { maskedText, flaggedWords } = maskProfanity(input);

      expect(maskedText).toBe(
        "The manager was a complete ******* and the service was ****."
      );
      expect(flaggedWords).toContain("asshole");
      expect(flaggedWords).toContain("shit");
    });

    it("does not false-positive on words containing substrings (e.g. Scunthorpe or classic)", () => {
      const input = "We enjoyed classic espresso near Scunthorpe.";
      const { maskedText, flaggedWords } = maskProfanity(input);
      expect(maskedText).toBe("We enjoyed classic espresso near Scunthorpe.");
      expect(flaggedWords).toHaveLength(0);
    });
  });

  describe("Character Length Constraints", () => {
    it("rejects comments shorter than MIN_COMMENT_LENGTH (3 characters)", () => {
      const shortComment = "ok";
      const result = validateReviewComment(shortComment);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        `Review comment must be at least ${MIN_COMMENT_LENGTH} characters.`
      );
    });

    it("truncates or flags comments exceeding MAX_COMMENT_LENGTH (1000 characters)", () => {
      const longComment = "a".repeat(1050);
      const result = validateReviewComment(longComment);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        `Review comment cannot exceed ${MAX_COMMENT_LENGTH} characters.`
      );

      const sanitized = sanitizeReviewComment(longComment, { allowFormatting: true });
      expect(sanitized.length).toBe(MAX_COMMENT_LENGTH);
    });

    it("accepts valid comments within length constraints", () => {
      const validComment = "Great environment to get work done with fast WiFi!";
      const result = validateReviewComment(validComment);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toBe(validComment);
    });
  });

  describe("Control Character Stripping (#5024)", () => {
    it("strips unprintable ASCII control characters matching /[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/g", () => {
      const input = "Hello\x00 World\x08!\x1F Test\x7F";
      expect(stripControlCharacters(input)).toBe("Hello World! Test");
    });

    it("preserves standard newlines (\\n) and tabs (\\t)", () => {
      const input = "Line 1\n\tIndented Line 2\x07";
      expect(stripControlCharacters(input)).toBe("Line 1\n\tIndented Line 2");
    });

    it("cleans control characters and normalizes spaces in cleanControlCharacters", () => {
      const input = "Clean\x00\x0B\x0C Text\x7F \twith\x1F spaces";
      expect(cleanControlCharacters(input)).toBe("Clean Text with spaces");
    });
  });
});
