/**
 * Access control for collaborative collection notes rooms (#3360).
 */
import WorkspaceServer, { folderIdFromRoom } from "../server";
import type * as Party from "partykit/server";
import { onConnect as onConnectYjs } from "y-partykit";

jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "user_1" }),
}));
jest.mock("y-partykit", () => ({ onConnect: jest.fn() }));

const fetchMock = jest.fn();
const originalEnv = process.env;

function connect(roomId: string, url = "http://localhost?token=t") {
  const conn = {
    id: "c1",
    state: {},
    setState: jest.fn(),
    send: jest.fn(),
    addEventListener: jest.fn(),
    close: jest.fn(),
  } as unknown as Party.Connection;
  const room = { id: roomId, getConnection: jest.fn(), broadcast: jest.fn() } as unknown as Party.Room;
  const server = new WorkspaceServer(room);
  return { conn, room, run: () => server.onConnect(conn, { request: { url } } as never) };
}

const authReturns = (body: Record<string, unknown>, ok = true) =>
  fetchMock.mockResolvedValue({ ok, json: async () => body });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  process.env = { ...originalEnv, PARTYKIT_AUTH_SECRET: "s3cret", NEXT_PUBLIC_APP_URL: "http://app" };
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  process.env = originalEnv;
});

it("maps folder and notes rooms to their folder id", () => {
  expect(folderIdFromRoom("folder-notes-abc")).toBe("abc");
  expect(folderIdFromRoom("folder-abc")).toBe("abc");
  expect(folderIdFromRoom("venue-1")).toBe("venue-1");
});

it("authenticates the role lookup with the shared secret", async () => {
  authReturns({ role: "EDITOR", member: true });
  await connect("folder-notes-abc").run();
  expect(fetchMock).toHaveBeenCalledWith(
    "http://app/api/partykit/auth?userId=user_1&folderId=abc",
    { headers: { Authorization: "Bearer s3cret" } },
  );
});

it("lets editors write and persists the notes document", async () => {
  authReturns({ role: "EDITOR", member: true });
  const { conn, run } = connect("folder-notes-abc");
  await run();
  expect(conn.close).not.toHaveBeenCalled();
  expect(onConnectYjs).toHaveBeenCalledWith(conn, expect.anything(), {
    gc: false,
    readOnly: false,
    persist: { mode: "snapshot" },
  });
});

it("gives viewer members read-only access", async () => {
  authReturns({ role: "VIEWER", member: true });
  await connect("folder-notes-abc").run();
  expect(onConnectYjs).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ readOnly: true }));
});

it.each([
  ["no token", undefined, "http://localhost"],
  ["a non-member", { role: "VIEWER", member: false }, undefined],
  ["a failed role lookup", null, undefined],
])("rejects %s from a notes room", async (_label, body, url) => {
  if (body === null) authReturns({}, false);
  else if (body) authReturns(body);
  const { conn, run } = connect("folder-notes-abc", url);
  await run();
  expect(conn.close).toHaveBeenCalledWith(4003, expect.stringMatching(/Forbidden/));
  expect(onConnectYjs).not.toHaveBeenCalled();
});

it("still lets editors write in regular folder rooms now that the lookup succeeds", async () => {
  authReturns({ role: "EDITOR", member: true });
  await connect("folder-abc").run();
  expect(onConnectYjs).toHaveBeenCalledWith(expect.anything(), expect.anything(), { gc: true, readOnly: false });
});
