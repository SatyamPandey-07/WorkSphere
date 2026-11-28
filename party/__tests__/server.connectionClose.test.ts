import WorkspaceServer from "../server";
import type * as Party from "partykit/server";

jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn(),
}));
jest.mock("y-partykit", () => ({ onConnect: jest.fn() }));

function makeConnection(id: string): Party.Connection {
  const connection: any = {
    id,
    state: {},
    setState: jest.fn((state) => {
      connection.state = { ...connection.state, ...state };
    }),
    send: jest.fn(),
    addEventListener: jest.fn(),
    close: jest.fn(),
  };
  return connection as Party.Connection;
}

describe("WorkspaceServer connection close identity", () => {
  let server: WorkspaceServer;
  let connections: Map<string, Party.Connection>;
  let room: Party.Room;

  const context = {
    request: { url: "https://example.test/venue-room" },
  } as unknown as Party.ConnectionContext;

  beforeEach(() => {
    jest.useFakeTimers();
    connections = new Map();
    room = {
      id: "venue-room",
      getConnection: jest.fn((id: string) => connections.get(id)),
      broadcast: jest.fn(),
    } as unknown as Party.Room;
    server = new WorkspaceServer(room);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("ignores an older socket close after a replacement connects with the same id", async () => {
    const oldSocket = makeConnection("shared-connection");
    const currentSocket = makeConnection("shared-connection");
    connections.set(oldSocket.id, oldSocket);
    await server.onConnect(oldSocket, context);

    connections.set(currentSocket.id, currentSocket);
    await server.onConnect(currentSocket, context);
    const connectionStates = (server as any).connectionStates as Map<
      string,
      unknown
    >;
    const currentState = connectionStates.get(currentSocket.id);

    server.onClose(oldSocket);

    expect(connections.get(currentSocket.id)).toBe(currentSocket);
    expect(connectionStates.get(currentSocket.id)).toBe(currentState);
    expect(room.broadcast).not.toHaveBeenCalled();
  });

  it("performs normal cleanup when the active socket closes", async () => {
    const currentSocket = makeConnection("active-connection");
    connections.set(currentSocket.id, currentSocket);
    await server.onConnect(currentSocket, context);

    const connectionStates = (server as any).connectionStates as Map<
      string,
      unknown
    >;
    expect(connectionStates.has(currentSocket.id)).toBe(true);

    server.onClose(currentSocket);

    expect(connectionStates.has(currentSocket.id)).toBe(false);
  });
});
