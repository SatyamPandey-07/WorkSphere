/**
 * Write access to venue notes rooms (`notes-{venueId}`, #7909).
 */
import WorkspaceServer, { GROUP_NOTES_ROOM_PREFIX } from "../server";
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
  const room = {
    id: roomId,
    getConnection: jest.fn(),
    broadcast: jest.fn(),
  } as unknown as Party.Room;
  const server = new WorkspaceServer(room);
  return {
    conn,
    run: () => server.onConnect(conn, { request: { url } } as never),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  process.env = {
    ...originalEnv,
    PARTYKIT_AUTH_SECRET: "s3cret",
    NEXT_PUBLIC_APP_URL: "http://app",
  };
  // What the auth route answers for an id that is not a folder.
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ role: "VIEWER", member: false }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  process.env = originalEnv;
});

it("uses the notes- prefix that GroupNotesEditor connects to", () => {
  expect(GROUP_NOTES_ROOM_PREFIX).toBe("notes-");
});

it("lets a signed-in user edit a venue notes room without a folder lookup", async () => {
  const { conn, run } = connect("notes-venue-1");
  await run();

  expect(fetchMock).not.toHaveBeenCalled();
  expect(conn.close).not.toHaveBeenCalled();
  expect(conn.setState).toHaveBeenCalledWith(
    expect.objectContaining({ role: "EDITOR", userId: "user_1" }),
  );
  expect(onConnectYjs).toHaveBeenCalledWith(conn, expect.anything(), {
    gc: true,
    readOnly: false,
  });
});

it("keeps a venue notes connection without a token read-only", async () => {
  const { conn, run } = connect("notes-venue-1", "http://localhost");
  await run();

  expect(onConnectYjs).toHaveBeenCalledWith(conn, expect.anything(), {
    gc: true,
    readOnly: true,
  });
});

it("still runs the folder lookup for collection notes rooms", async () => {
  const { conn, run } = connect("folder-notes-abc");
  await run();

  expect(fetchMock).toHaveBeenCalledWith(
    "http://app/api/partykit/auth?userId=user_1&folderId=abc",
    expect.anything(),
  );
  expect(conn.close).toHaveBeenCalledWith(
    4003,
    expect.stringMatching(/Forbidden/),
  );
});
