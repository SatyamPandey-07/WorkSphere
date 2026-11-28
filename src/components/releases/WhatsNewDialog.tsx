"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

type ReleaseInfo = {
  version: string;
  tag: string;
  notesSummary: string;
  prerelease: boolean;
  publishedAt: string | null;
  url: string;
  downloads: Array<{
    name: string;
    url: string;
    size: number;
  }>;
};

type CopyTarget = "tag" | "checksum";

const LAST_SEEN_VERSION_KEY = "worksphere:last-seen-release-version";
const VERIFY_CHECKSUM_COMMAND = "sha256sum -c SHA256SUMS.txt";
const COPY_FEEDBACK_DURATION_MS = 2000;

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to execCommand when Clipboard API rejects.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.opacity = "0";

  try {
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.parentNode?.removeChild(textArea);
  }
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseReleaseInfo(payload: unknown): ReleaseInfo | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const webRelease = (payload as Record<string, unknown>).web;
  if (typeof webRelease !== "object" || webRelease === null) {
    return null;
  }

  const fields = webRelease as Record<string, unknown>;
  if (typeof fields.version !== "string" || fields.version.length === 0) {
    return null;
  }

  const downloads = Array.isArray(fields.downloads)
    ? fields.downloads.flatMap((download) => {
        if (typeof download !== "object" || download === null) {
          return [];
        }
        const item = download as Record<string, unknown>;
        const url = safeExternalUrl(item.url);
        if (typeof item.name !== "string" || !url) {
          return [];
        }
        return [
          {
            name: item.name,
            url,
            size: typeof item.size === "number" ? item.size : 0,
          },
        ];
      })
    : [];
  const url = safeExternalUrl(fields.url);

  return {
    version: fields.version,
    tag: typeof fields.tag === "string" ? fields.tag : fields.version,
    notesSummary:
      typeof fields.notesSummary === "string" ? fields.notesSummary : "",
    prerelease: fields.prerelease === true,
    publishedAt:
      typeof fields.publishedAt === "string" ? fields.publishedAt : null,
    url: url ?? "",
    downloads,
  };
}

function readLastSeenVersion(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

function persistLastSeenVersion(version: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
  } catch {
    // Keep dismissal functional when browser storage is unavailable.
  }
}

export function WhatsNewDialog() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadLatestRelease() {
      try {
        const response = await fetch("/api/releases/latest", {
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }

        const latest = parseReleaseInfo(await response.json());
        if (!latest) {
          return;
        }

        if (readLastSeenVersion() !== latest.version) {
          setRelease(latest);
          setIsOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setRelease(null);
        }
      }
    }

    void loadLatestRelease();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [isOpen]);

  if (!isOpen || !release) {
    return null;
  }

  function dismiss() {
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    setCopiedTarget(null);
    persistLastSeenVersion(release.version);
    setIsOpen(false);
  }

  async function handleCopy(target: CopyTarget, value: string) {
    const copied = await copyTextToClipboard(value);
    if (!copied) {
      return;
    }
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    setCopiedTarget(target);
    copyTimerRef.current = setTimeout(() => {
      setCopiedTarget(null);
      copyTimerRef.current = null;
    }, COPY_FEEDBACK_DURATION_MS);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusableElements = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusableElements.item(0);
    const last = focusableElements.item(focusableElements.length - 1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const publishedDate = release.publishedAt
    ? new Date(release.publishedAt)
    : null;
  const formattedPublishedDate =
    publishedDate && !Number.isNaN(publishedDate.getTime())
      ? publishedDate.toLocaleDateString()
      : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        aria-describedby="whats-new-notes"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl outline-none dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
              What&apos;s new
            </p>
            <h2
              id="whats-new-title"
              className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100"
            >
              WorkSphere {release.version}
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close What's New"
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
          {release.prerelease && (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Pre-release
            </span>
          )}
          <p id="whats-new-notes" className="whitespace-pre-wrap leading-6">
            {release.notesSummary || "Explore the latest WorkSphere updates."}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Release tag: {release.tag}
            {formattedPublishedDate && ` · Published ${formattedPublishedDate}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy("tag", release.tag)}
              aria-label={
                copiedTarget === "tag"
                  ? `Copied release tag ${release.tag}`
                  : `Copy release tag ${release.tag}`
              }
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {copiedTarget === "tag" ? "Copied tag" : "Copy tag"}
            </button>
            <button
              type="button"
              onClick={() =>
                void handleCopy("checksum", VERIFY_CHECKSUM_COMMAND)
              }
              aria-label={
                copiedTarget === "checksum"
                  ? "Copied SHA-256 verification command"
                  : "Copy SHA-256 verification command"
              }
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {copiedTarget === "checksum"
                ? "Copied command"
                : "Copy SHA-256 command"}
            </button>
            <span role="status" aria-live="polite" className="sr-only">
              {copiedTarget === "tag"
                ? `Copied release tag ${release.tag}`
                : copiedTarget === "checksum"
                  ? "Copied SHA-256 verification command"
                  : ""}
            </span>
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            {release.url && (
              <a
                href={release.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900 dark:text-indigo-300"
              >
                Full release notes
              </a>
            )}
            {release.downloads.map((download) => (
              <a
                key={`${download.name}-${download.url}`}
                href={download.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900 dark:text-indigo-300"
              >
                Download {download.name}
              </a>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}
