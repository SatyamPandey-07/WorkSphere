/**
 * CollectionNotesEditor (#3360): wires the textarea to the shared Y.Text.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as Y from "yjs";
import { CollectionNotesEditor } from "@/components/collections/CollectionNotesEditor";
import { getCollectionNotesText } from "@/lib/crdt/collectionNotes";

type Handler = (arg: unknown) => void;

class FakeProvider {
  static last: FakeProvider;
  handlers: Record<string, Handler[]> = {};
  constructor(
    public host: string,
    public room: string,
    public doc: Y.Doc,
    public options: { params: () => Promise<Record<string, string>> },
  ) {
    FakeProvider.last = this;
  }
  on(event: string, fn: Handler) {
    (this.handlers[event] ??= []).push(fn);
  }
  off(event: string, fn: Handler) {
    this.handlers[event] = (this.handlers[event] ?? []).filter((h) => h !== fn);
  }
  emit(event: string, arg: unknown) {
    (this.handlers[event] ?? []).forEach((h) => h(arg));
  }
  destroy() {}
}

jest.mock("y-partykit/provider", () => ({ __esModule: true, default: jest.fn((...args: unknown[]) => new (FakeProvider as any)(...args)) }));
jest.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: jest.fn().mockResolvedValue("clerk-token") }) }));

const fetchMock = jest.fn().mockResolvedValue({ ok: true });

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  // jsdom has no rAF timing guarantees under fake timers
  global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
});
afterEach(() => jest.useRealTimers());

const textarea = () => screen.getByRole("textbox", { name: "Collection notes" }) as HTMLTextAreaElement;

it("joins the members-only room with a Clerk token and seeds from the description", async () => {
  render(<CollectionNotesEditor folderId="f1" initialText="Bring ID." canEdit />);
  const provider = FakeProvider.last;
  expect(provider.room).toBe("folder-notes-f1");
  await expect(provider.options.params()).resolves.toEqual({ token: "clerk-token" });

  act(() => provider.emit("sync", true));
  expect(getCollectionNotesText(provider.doc).toString()).toBe("Bring ID.");
  expect(textarea().value).toBe("Bring ID.");
  expect(screen.getByText(/edits merge automatically/i)).toBeInTheDocument();
});

it("merges local typing with a concurrent remote edit and snapshots the result", () => {
  render(<CollectionNotesEditor folderId="f1" initialText={"Para one.\n\nPara two."} canEdit />);
  const provider = FakeProvider.last;
  act(() => provider.emit("sync", true));

  // A collaborator, starting from the same state, edits paragraph two.
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(provider.doc));

  // Local user edits paragraph one through the textarea.
  fireEvent.change(textarea(), { target: { value: "Para one, edited.\n\nPara two." } });
  getCollectionNotesText(remote).insert("Para one.\n\nPara two".length, " (remote)");

  act(() => {
    Y.applyUpdate(provider.doc, Y.encodeStateAsUpdate(remote), "remote");
  });
  expect(textarea().value).toBe("Para one, edited.\n\nPara two (remote).");

  act(() => jest.advanceTimersByTime(1500));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/folders/f1",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ description: "Para one, edited.\n\nPara two (remote)." }),
    }),
  );
});

it("is read-only for viewers and never seeds or snapshots", () => {
  render(<CollectionNotesEditor folderId="f1" initialText="Legacy text" canEdit={false} />);
  const provider = FakeProvider.last;
  act(() => provider.emit("sync", true));
  expect(getCollectionNotesText(provider.doc).length).toBe(0);
  expect(textarea()).toHaveAttribute("readonly");

  fireEvent.change(textarea(), { target: { value: "hack" } });
  act(() => jest.advanceTimersByTime(5000));
  expect(getCollectionNotesText(provider.doc).toString()).toBe("");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows when it is offline", () => {
  render(<CollectionNotesEditor folderId="f1" initialText={null} canEdit />);
  act(() => FakeProvider.last.emit("status", { status: "disconnected" }));
  expect(screen.getByText(/changes will merge on reconnect/i)).toBeInTheDocument();
});
