/**
 * SVG and QR Code Sanitizer
 * Protects against embedded script injection, malicious event handlers,
 * XML External Entity (XXE) attacks, and XSS in user uploads and QR codes.
 */

// Safe CSS color pattern: hex, rgb, rgba, hsl, hsla, safe named colors, transparent, none, currentColor
const SAFE_COLOR_REGEX =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.%\s,+-/]+\s*\)|hsla?\(\s*[\d.%\s,deg+-/]+\s*\)|transparent|currentColor|none|[a-zA-Z]{3,20})$/;

/**
 * Validates and sanitizes a CSS color string.
 * Returns defaultColor if the input is invalid or contains potentially malicious characters.
 */
export function sanitizeColor(
  color: unknown,
  defaultColor: string = "#000000",
): string {
  if (typeof color !== "string") return defaultColor;
  const trimmed = color.trim();
  if (!trimmed || trimmed.length > 50) return defaultColor;
  // Disallow characters that could break attributes or inject scripts
  if (/[<>"'`\\;\(\)\{\}]/.test(trimmed) && !/^(rgba?|hsla?)\(/.test(trimmed)) {
    return defaultColor;
  }
  if (SAFE_COLOR_REGEX.test(trimmed)) {
    return trimmed;
  }
  return defaultColor;
}

/**
 * Checks if a string or buffer contains SVG content.
 */
export function isSvgContent(content: string | Buffer): boolean {
  try {
    const text = (
      typeof content === "string" ? content : content.toString("utf-8")
    ).trim();
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1).trim() : text;
    return (
      clean.startsWith("<svg") ||
      (clean.startsWith("<?xml") && clean.includes("<svg")) ||
      clean.includes("<svg xmlns") ||
      (clean.startsWith("<!DOCTYPE") && clean.includes("<svg"))
    );
  } catch {
    return false;
  }
}

/**
 * Decodes HTML / XML entities and strips null bytes and control characters
 * for inspection of attribute values.
 */
function normalizeAttributeValue(val: string): string {
  return val
    .replace(/\0/g, "")
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/[\s\u0000-\u001F\u007F-\u009F]/g, "")
    .toLowerCase();
}

/**
 * Checks if an attribute value contains a dangerous URI protocol.
 */
function isDangerousUri(val: string): boolean {
  const normalized = normalizeAttributeValue(val);
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:text/html") ||
    normalized.startsWith("data:image/svg+xml") ||
    normalized.includes("javascript:") ||
    normalized.includes("data:text/html")
  );
}

/**
 * Sanitizes CSS style strings by stripping dangerous expressions, urls, and imports.
 */
export function sanitizeCss(css: string): string {
  return css
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(
      /url\s*\(\s*['"]?\s*(javascript:|vbscript:|data:text\/html)[^)]*\)/gi,
      "",
    )
    .replace(/@import[^;]*;/gi, "")
    .replace(/behavior\s*:[^;]*/gi, "")
    .replace(/-moz-binding\s*:[^;]*/gi, "");
}

/**
 * Thoroughly sanitizes SVG strings to prevent embedded script injection,
 * malicious event handlers, XXE attacks, and dangerous external references.
 */
export function sanitizeSvg(svgContent: string): string {
  if (!svgContent || typeof svgContent !== "string") {
    return "";
  }

  let sanitized = svgContent.trim();

  // 1. Remove XML/DTD entity declarations & processing instructions
  sanitized = sanitized.replace(/<!DOCTYPE[^>]*(\[[^\]]*\])?>/gi, "");
  sanitized = sanitized.replace(/<!ENTITY[^>]*>/gi, "");
  sanitized = sanitized.replace(/<\?xml-stylesheet[^>]*\?>/gi, "");

  // 2. Remove dangerous tags and their content
  const dangerousTags = [
    "script",
    "foreignobject",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "base",
    "meta",
    "link",
    "handler",
    "listener",
    "audio",
    "video",
    "form",
    "input",
    "button",
    "textarea",
    "select",
  ];

  for (const tag of dangerousTags) {
    const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?<\\/${tag}>)?`, "gi");
    sanitized = sanitized.replace(regex, "");
    // Also strip standalone self-closing or unclosed variants
    const singleRegex = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    sanitized = sanitized.replace(singleRegex, "");
    const closeRegex = new RegExp(`<\\/${tag}>`, "gi");
    sanitized = sanitized.replace(closeRegex, "");
  }

  // 3. Remove all inline event handlers (on*)
  sanitized = sanitized.replace(
    /\s+on[a-zA-Z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );

  // 4. Sanitize href, xlink:href, src, formaction, data attributes
  sanitized = sanitized.replace(
    /\s+(?:href|xlink:href|src|action|formaction|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, dq, sq, bare) => {
      const val = dq ?? sq ?? bare ?? "";
      if (isDangerousUri(val)) {
        return "";
      }
      return match;
    },
  );

  // 5. Sanitize style attributes
  sanitized = sanitized.replace(
    /\s+style\s*=\s*(["'])(.*?)\1/gi,
    (_, quote, val) => {
      const cleanVal = sanitizeCss(val);
      if (!cleanVal.trim()) return "";
      return ` style=${quote}${cleanVal}${quote}`;
    },
  );

  // 6. Sanitize <style> tag content
  sanitized = sanitized.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (_, attrs, cssContent) => {
      const cleanCss = sanitizeCss(cssContent);
      return `<style${attrs}>${cleanCss}</style>`;
    },
  );

  // 7. Remove <use> tags that reference external or javascript URIs
  sanitized = sanitized.replace(
    /<use\b[^>]*(?:href|xlink:href)\s*=\s*(["'])(.*?)\1[^>]*\/?>/gi,
    (match, quote, href) => {
      if (isDangerousUri(href) || (href.includes("://") && !href.startsWith("#"))) {
        return "";
      }
      return match;
    },
  );

  // 8. Remove CDATA sections containing scripts or event handlers
  sanitized = sanitized.replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, (cdata) => {
    if (/script|javascript:|on[a-zA-Z]+/i.test(cdata)) {
      return "";
    }
    return cdata;
  });

  return sanitized.trim();
}
