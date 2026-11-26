export const TRUSTED_IMAGE_HOSTS = new Set<string>([
  'res.cloudinary.com',
  'images.unsplash.com',
]);

export type ChatSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'image'; alt: string; src: string };

const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

export function isSafeHttpUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function isTrustedImageUrl(
  rawUrl: string,
  extraTrustedHosts: Iterable<string> = []
): boolean {
  const parsed = isSafeHttpUrl(rawUrl);
  if (!parsed || parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (TRUSTED_IMAGE_HOSTS.has(host)) return true;

  for (const extra of extraTrustedHosts) {
    if (extra.trim().toLowerCase() === host) {
      return true;
    }
  }
  return false;
}

export function sanitizeChatImageMarkdown(
  content: string,
  extraTrustedHosts: Iterable<string> = []
): string {
  return content.replace(
    MARKDOWN_IMAGE_REGEX,
    (_match, rawAlt: string, rawUrl: string) => {
      const alt = rawAlt.trim() || 'image';
      const parsed = isSafeHttpUrl(rawUrl);
      if (!parsed) {
        return alt;
      }

      if (isTrustedImageUrl(parsed.toString(), extraTrustedHosts)) {
        return `![${alt}](${parsed.toString()})`;
      }

      return `[${alt}](${parsed.toString()})`;
    }
  );
}

export function parseSanitizedChatSegments(
  content: string,
  extraTrustedHosts: Iterable<string> = []
): ChatSegment[] {
  const sanitized = sanitizeChatImageMarkdown(content, extraTrustedHosts);
  const tokenRegex = /(!?\[[^\]]*\]\([^)\s]+\))/g;
  const segments: ChatSegment[] = [];
  let lastIndex = 0;

  for (const match of sanitized.matchAll(tokenRegex)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      segments.push({ type: 'text', value: sanitized.slice(lastIndex, index) });
    }

    const isImg = token.startsWith('![');
    const parsedMatch = token.match(/^!?\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (parsedMatch) {
      const label = parsedMatch[1];
      const href = parsedMatch[2];
      if (isImg && isTrustedImageUrl(href, extraTrustedHosts)) {
        segments.push({ type: 'image', alt: label, src: href });
      } else {
        segments.push({ type: 'link', label, href });
      }
    } else {
      segments.push({ type: 'text', value: token });
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < sanitized.length) {
    segments.push({ type: 'text', value: sanitized.slice(lastIndex) });
  }

  return segments;
}
