const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  try {
    str = typeof value === "string" ? value : String(value);
  } catch {
    return "";
  }
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] || ch);
}
