"use client";

import { Fragment, useCallback, useRef, type ReactNode } from "react";
import type { ShapeData } from "@/hooks/useCanvasWhiteboard";

interface StickyNotesProps {
  notes: ShapeData[];
  onUpdate: (id: string, updates: Partial<ShapeData>) => void;
}

const MIN_WIDTH = 160;
const MIN_HEIGHT = 120;

function getBounds(note: ShapeData) {
  const x = Number.isFinite(note.points[0]) ? note.points[0] : 0;
  const y = Number.isFinite(note.points[1]) ? note.points[1] : 0;
  const right = Number.isFinite(note.points[2]) ? note.points[2] : x + 220;
  const bottom = Number.isFinite(note.points[3]) ? note.points[3] : y + 160;
  return {
    x,
    y,
    width: Math.max(MIN_WIDTH, right - x),
    height: Math.max(MIN_HEIGHT, bottom - y),
  };
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("*") && token.endsWith("*")) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-amber-200/70 px-1">
          {token.slice(1, -1)}
        </code>
      );
    }
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) {
      return (
        <a
          key={index}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{token}</Fragment>;
  });
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const lines = markdown.split(/\r?\n/);
  return (
    <div className="space-y-1">
      {lines.map((line, index) => {
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          const Heading = heading[1].length === 1 ? "h3" : "h4";
          return (
            <Heading key={index} className="font-semibold">
              {renderInlineMarkdown(heading[2])}
            </Heading>
          );
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <li key={index} className="ml-4 list-disc">
              {renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}
            </li>
          );
        }
        return line ? <p key={index}>{renderInlineMarkdown(line)}</p> : <br key={index} />;
      })}
    </div>
  );
}

export function StickyNotes({ notes, onUpdate }: StickyNotesProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {notes.map((note) => (
        <StickyNote key={note.id} note={note} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function StickyNote({ note, onUpdate }: { note: ShapeData; onUpdate: StickyNotesProps["onUpdate"] }) {
  const bounds = getBounds(note);
  const dragStart = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const resizeStart = useRef<{ clientX: number; clientY: number; width: number; height: number } | null>(null);

  const updatePoints = useCallback(
    (x: number, y: number, width: number, height: number) => {
      onUpdate(note.id, { points: [x, y, x + width, y + height] });
    },
    [note.id, onUpdate],
  );

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const clientX = Number.isFinite(event.clientX) ? event.clientX : 0;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : 0;
    dragStart.current = {
      clientX,
      clientY,
      x: bounds.x,
      y: bounds.y,
    };
  };

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const clientX = Number.isFinite(event.clientX)
      ? event.clientX
      : dragStart.current.clientX;
    const clientY = Number.isFinite(event.clientY)
      ? event.clientY
      : dragStart.current.clientY;
    updatePoints(
      dragStart.current.x + clientX - dragStart.current.clientX,
      dragStart.current.y + clientY - dragStart.current.clientY,
      bounds.width,
      bounds.height,
    );
  };

  const handleDragEnd = () => {
    dragStart.current = null;
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const clientX = Number.isFinite(event.clientX) ? event.clientX : 0;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : 0;
    resizeStart.current = {
      clientX,
      clientY,
      width: bounds.width,
      height: bounds.height,
    };
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!resizeStart.current) return;
    const clientX = Number.isFinite(event.clientX)
      ? event.clientX
      : resizeStart.current.clientX;
    const clientY = Number.isFinite(event.clientY)
      ? event.clientY
      : resizeStart.current.clientY;
    updatePoints(
      bounds.x,
      bounds.y,
      Math.max(MIN_WIDTH, resizeStart.current.width + clientX - resizeStart.current.clientX),
      Math.max(MIN_HEIGHT, resizeStart.current.height + clientY - resizeStart.current.clientY),
    );
  };

  const handleResizeEnd = () => {
    resizeStart.current = null;
  };

  return (
    <article
      data-testid={`sticky-note-${note.id}`}
      className="pointer-events-auto absolute overflow-hidden rounded-md border border-amber-300 bg-amber-100 text-zinc-900 shadow-lg dark:border-amber-700 dark:bg-amber-200"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
    >
      <div
        className="flex h-7 cursor-grab items-center justify-between border-b border-amber-300/70 bg-amber-300/60 px-2 text-[10px] font-semibold uppercase tracking-wide active:cursor-grabbing"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <span>Sticky note</span>
        <span aria-hidden="true">↕</span>
      </div>
      <div className="grid h-[calc(100%-1.75rem)] grid-rows-1 overflow-hidden">
        <div className="grid min-h-0 grid-cols-2 gap-1 p-2">
          <textarea
            aria-label={`Edit sticky note ${note.id}`}
            value={note.text ?? ""}
            onChange={(event) => onUpdate(note.id, { text: event.target.value })}
            className="min-h-0 min-w-0 resize-none rounded border border-amber-300/60 bg-amber-50/70 p-1 text-xs outline-none focus:ring-1 focus:ring-amber-500 dark:bg-amber-100/70"
          />
          <div className="min-w-0 overflow-auto rounded border border-amber-300/40 bg-white/30 p-1 text-xs">
            <MarkdownPreview markdown={note.text ?? ""} />
          </div>
        </div>
      </div>
      <button
        type="button"
        aria-label={`Resize sticky note ${note.id}`}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-amber-400/70"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
    </article>
  );
}
