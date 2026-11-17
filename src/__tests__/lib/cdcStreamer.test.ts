/**
 * PostgreSQL logical-replication CDC streamer: unit tests.
 *
 * Covers the parts that are pure and deterministic: LSN arithmetic, decoding
 * of both supported plugins, allow-list filtering, the event shape published
 * to Redis, the restart/idempotency guards and the durable checkpoint store.
 */

jest.mock("@/lib/redis", () => {
  const state: { redis: any } = { redis: null };
  return { getRedis: () => state.redis, __state: state };
});

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CDC_STREAM_KEY,
  CDC_TABLES,
  CompositeLsnStore,
  FileLsnStore,
  MemoryLsnStore,
  PgOutputDecoder,
  buildCdcStreamFields,
  buildStandbyStatusUpdate,
  buildStartReplicationCommand,
  compareLsn,
  computeReconnectDelay,
  createCdcPublisher,
  formatLsn,
  parseLsn,
  parseTestDecodingOutput,
  shouldProcessLsn,
  transformCdcChange,
  type CdcChangeEvent,
  type CdcRedisLike,
} from "@/lib/database/cdcStreamer";

const { __state: redisState } = jest.requireMock("@/lib/redis") as {
  __state: { redis: any };
};

afterEach(() => {
  redisState.redis = null;
});

// ---------------------------------------------------------------------------
// LSN helpers
// ---------------------------------------------------------------------------

describe("LSN helpers", () => {
  it("round-trips PostgreSQL LSN strings", () => {
    expect(parseLsn("0/0")).toBe(BigInt(0));
    expect(parseLsn("0/16B374D8")).toBe(BigInt(0x16b374d8));
    expect(formatLsn(BigInt(0x16b374d8))).toBe("0/16B374D8");
    expect(formatLsn(parseLsn("16/B374D848"))).toBe("16/B374D848");
  });

  it("treats unknown or missing values as the zero LSN", () => {
    expect(parseLsn(null)).toBe(BigInt(0));
    expect(parseLsn(undefined)).toBe(BigInt(0));
    expect(parseLsn("not-an-lsn")).toBe(BigInt(0));
  });

  it("compares and gate-keeps checkpoints", () => {
    expect(compareLsn("0/1", "0/2")).toBe(-1);
    expect(compareLsn("0/2", "0/2")).toBe(0);
    expect(compareLsn("1/0", "0/FFFFFFFFFFFFFFFF")).toBe(1);
    expect(shouldProcessLsn("0/5", null)).toBe(true);
    expect(shouldProcessLsn("0/5", "0/5")).toBe(false);
    expect(shouldProcessLsn("0/6", "0/5")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// test_decoding parser
// ---------------------------------------------------------------------------

describe("test_decoding parser", () => {
  it("parses INSERT rows with quoted, unquoted and NULL values", () => {
    const decoded = parseTestDecodingOutput(
      [
        "BEGIN 123",
        `table public."Booking": INSERT: id[integer]:1 label[text]:'O''Brien' price[numeric]:12.5 active[boolean]:'t' meta[jsonb]:'{"a":1}' note[text]:null`,
        "COMMIT 123",
      ].join("\n"),
    );

    expect(decoded.begin?.xid).toBe(123);
    expect(decoded.commit?.xid).toBe(123);
    expect(decoded.changes).toHaveLength(1);

    const [change] = decoded.changes;
    expect(change.schema).toBe("public");
    expect(change.table).toBe("Booking");
    expect(change.operation).toBe("INSERT");
    expect(change.txId).toBe(123);
    expect(change.new).toEqual({
      id: 1,
      label: "O'Brien",
      price: 12.5,
      active: true,
      meta: { a: 1 },
      note: null,
    });
  });

  it("keeps newlines inside decoded text values", () => {
    const decoded = parseTestDecodingOutput(
      [
        "BEGIN 1",
        `table public."Booking": INSERT: id[integer]:1 notes[text]:'first line`,
        `second line'`,
        "COMMIT 1",
      ].join("\n"),
    );

    expect(decoded.changes).toHaveLength(1);
    expect(decoded.changes[0].new).toEqual({
      id: 1,
      notes: "first line\nsecond line",
    });
  });

  it("parses UPDATE old-key/new-tuple rows", () => {
    const decoded = parseTestDecodingOutput(
      `table public."DeskLock": UPDATE: old-key: id[integer]:7 new-tuple: id[integer]:7 locked[boolean]:'f'`,
    );

    expect(decoded.changes[0].old).toEqual({ id: 7 });
    expect(decoded.changes[0].new).toEqual({ id: 7, locked: false });
  });

  it("parses DELETE rows", () => {
    const decoded = parseTestDecodingOutput(
      `table public."VenueTelemetry": DELETE: id[bigint]:42`,
    );

    expect(decoded.changes[0].old).toEqual({ id: 42 });
    expect(decoded.changes[0].new).toBeNull();
  });

  it("recovers the transaction id for changes split across lines", () => {
    const decoded = parseTestDecodingOutput(
      [
        "BEGIN 9",
        `table public."Booking": INSERT: id[integer]:1`,
        `table public."VenueTelemetry": INSERT: id[integer]:2`,
        "COMMIT 9",
      ].join("\n"),
    );

    expect(decoded.changes.map((change) => change.txId)).toEqual([9, 9]);
  });

  it("ignores transaction delimiters without changes", () => {
    const decoded = parseTestDecodingOutput("BEGIN 5\nCOMMIT 5");
    expect(decoded.changes).toHaveLength(0);
    expect(decoded.begin?.xid).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// pgoutput decoder
// ---------------------------------------------------------------------------

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

function tuple(values: Array<string | null>): Buffer {
  const parts: Buffer[] = [];
  const count = Buffer.alloc(2);
  count.writeInt16BE(values.length, 0);
  parts.push(count);

  for (const value of values) {
    if (value === null) {
      parts.push(Buffer.from([0x6e]));
      continue;
    }
    const body = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length, 0);
    parts.push(Buffer.from([0x74]), length, body);
  }

  return Buffer.concat(parts);
}

function relationMessage(
  oid: number,
  schema: string,
  table: string,
  columns: Array<[string, number]>,
): Buffer {
  const head = Buffer.alloc(5);
  head.write("R", 0, "ascii");
  head.writeUInt32BE(oid, 1);

  const count = Buffer.alloc(2);
  count.writeInt16BE(columns.length, 0);

  const columnsBuffer: Buffer[] = [];
  for (const [name, typeOid] of columns) {
    const type = Buffer.alloc(4);
    type.writeUInt32BE(typeOid, 0);
    const typmod = Buffer.alloc(4);
    typmod.writeInt32BE(-1, 0);
    columnsBuffer.push(Buffer.from([1]), cstring(name), type, typmod);
  }

  return Buffer.concat([
    head,
    cstring(schema),
    cstring(table),
    Buffer.from("d", "ascii"),
    count,
    ...columnsBuffer,
  ]);
}

function beginMessage(finalLsn: bigint, xid: number): Buffer {
  const buffer = Buffer.alloc(21);
  buffer.write("B", 0, "ascii");
  buffer.writeBigUInt64BE(finalLsn, 1);
  buffer.writeBigInt64BE(BigInt(0), 9);
  buffer.writeInt32BE(xid, 17);
  return buffer;
}

describe("pgoutput decoder", () => {
  it("decodes relations plus insert/update/delete/truncate messages", () => {
    const decoder = new PgOutputDecoder();

    expect(decoder.parse(beginMessage(BigInt(0x1000), 77))?.type).toBe("begin");
    expect(
      decoder.parse(
        relationMessage(16384, "public", "Booking", [
          ["id", 23],
          ["label", 25],
          ["active", 16],
        ]),
      )?.type,
    ).toBe("relation");

    const insert = decoder.parse(
      Buffer.concat([
        Buffer.from("I", "ascii"),
        Buffer.from([0, 0, 0x40, 0x00]),
        Buffer.from("N", "ascii"),
        tuple(["5", "hello", "t"]),
      ]),
    );
    expect(insert?.changes[0]).toMatchObject({
      table: "Booking",
      operation: "INSERT",
      txId: 77,
    });
    expect(insert?.changes[0].new).toEqual({
      id: 5,
      label: "hello",
      active: true,
    });

    const update = decoder.parse(
      Buffer.concat([
        Buffer.from("U", "ascii"),
        Buffer.from([0, 0, 0x40, 0x00]),
        Buffer.from("K", "ascii"),
        tuple(["5"]),
        Buffer.from("N", "ascii"),
        tuple(["5", "bye", "f"]),
      ]),
    );
    expect(update?.changes[0].old).toEqual({ id: 5 });
    expect(update?.changes[0].new).toEqual({
      id: 5,
      label: "bye",
      active: false,
    });

    const remove = decoder.parse(
      Buffer.concat([
        Buffer.from("D", "ascii"),
        Buffer.from([0, 0, 0x40, 0x00]),
        Buffer.from("K", "ascii"),
        tuple(["5"]),
      ]),
    );
    expect(remove?.changes[0].old).toEqual({ id: 5 });
    expect(remove?.changes[0].new).toBeNull();

    const truncate = decoder.parse(
      Buffer.concat([
        Buffer.from("T", "ascii"),
        Buffer.from([0, 0, 0, 1]),
        Buffer.from([0]),
        Buffer.from([0, 0, 0x40, 0x00]),
      ]),
    );
    expect(truncate?.changes[0].operation).toBe("TRUNCATE");
  });

  it("tolerates change messages for unknown relations", () => {
    const decoder = new PgOutputDecoder();
    const message = decoder.parse(
      Buffer.concat([
        Buffer.from("I", "ascii"),
        Buffer.from([0, 0, 0x77, 0x77]),
        Buffer.from("N", "ascii"),
      ]),
    );

    expect(message?.type).toBe("change");
    expect(message?.changes).toHaveLength(0);
    expect(message?.relationIds).toEqual([0x7777]);
  });
});

// ---------------------------------------------------------------------------
// Event transformation
// ---------------------------------------------------------------------------

describe("transformCdcChange", () => {
  it("builds a deterministic event id from slot, LSN and index", () => {
    const event = transformCdcChange(
      {
        schema: "public",
        table: "Booking",
        operation: "UPDATE",
        old: { id: 1 },
        new: { id: 1, status: "CONFIRMED" },
        txId: 9,
      },
      { slot: "slot_a", lsn: "0/16B374D8", index: 2, receivedAt: 1000 },
    );

    expect(event?.id).toBe("slot_a:0/16B374D8:2");
    expect(event?.eventId).toBe(event?.id);
    expect(event?.data).toEqual({ id: 1, status: "CONFIRMED" });
    expect(event?.timestamp).toBe(new Date(1000).toISOString());
  });

  it("uses the old image for deletes", () => {
    const event = transformCdcChange(
      {
        schema: "public",
        table: "DeskLock",
        operation: "DELETE",
        old: { id: 3 },
        new: null,
        txId: null,
      },
      { lsn: "0/A" },
    );

    expect(event?.data).toEqual({ id: 3 });
    expect(event?.new).toBeNull();
  });

  it("drops tables outside the availability allow-list", () => {
    const event = transformCdcChange(
      {
        schema: "public",
        table: "User",
        operation: "INSERT",
        old: null,
        new: { id: 1 },
        txId: null,
      },
      { lsn: "0/1" },
    );

    expect(event).toBeNull();
    expect(CDC_TABLES).toContain("Booking");
  });

  it("flattens the event into filterable stream fields", () => {
    const event = transformCdcChange(
      {
        schema: "public",
        table: "Booking",
        operation: "INSERT",
        old: null,
        new: { id: 3 },
        txId: null,
      },
      { slot: "s", lsn: "0/A", receivedAt: 10 },
    ) as CdcChangeEvent;

    const fields = buildCdcStreamFields(event);
    expect(fields).toMatchObject({
      id: "s:0/A:0",
      type: "Booking.INSERT",
      table: "Booking",
      operation: "INSERT",
      lsn: "0/A",
    });
    expect(JSON.parse(String(fields.data)).table).toBe("Booking");
  });
});

// ---------------------------------------------------------------------------
// Replication protocol frames
// ---------------------------------------------------------------------------

describe("replication protocol frames", () => {
  it("builds a 34-byte standby status update", () => {
    const frame = buildStandbyStatusUpdate("0/16B374D8", true, 0);

    expect(frame).toHaveLength(34);
    expect(String.fromCharCode(frame[0])).toBe("r");
    expect(frame.readBigUInt64BE(1)).toBe(parseLsn("0/16B374D8"));
    expect(frame.readBigUInt64BE(9)).toBe(parseLsn("0/16B374D8"));
    expect(frame.readBigUInt64BE(17)).toBe(parseLsn("0/16B374D8"));
    expect(frame[33]).toBe(1);
  });

  it("quotes slot and publication identifiers", () => {
    expect(
      buildStartReplicationCommand({ slot: 'we"ird', plugin: "test_decoding" }),
    ).toBe(`START_REPLICATION SLOT "we""ird" LOGICAL 0/0`);

    expect(
      buildStartReplicationCommand({
        slot: "s",
        plugin: "pgoutput",
        publication: "pub'x",
      }),
    ).toBe(
      `START_REPLICATION SLOT "s" LOGICAL 0/0 ("proto_version" '1', "publication_names" 'pub''x')`,
    );
  });
});

describe("reconnect backoff", () => {
  it("grows exponentially and stays within the jittered cap", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const delay = computeReconnectDelay({
        attempt,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitter: 0.1,
      });

      expect(delay).toBeGreaterThanOrEqual(90);
      expect(delay).toBeLessThanOrEqual(1100);
    }
  });
});

// ---------------------------------------------------------------------------
// Durable checkpoints
// ---------------------------------------------------------------------------

describe("LSN stores", () => {
  it("resumes from the newest available checkpoint", async () => {
    const older = new MemoryLsnStore();
    const newer = new MemoryLsnStore();
    await older.save("slot", "0/10");
    await newer.save("slot", "0/20");

    await expect(
      new CompositeLsnStore([older, newer]).load("slot"),
    ).resolves.toBe("0/20");
    await expect(
      new CompositeLsnStore([newer, older]).load("slot"),
    ).resolves.toBe("0/20");
  });

  it("writes at least one backend before acknowledging", async () => {
    const failing = {
      load: async () => null,
      save: async () => {
        throw new Error("redis down");
      },
    };
    const working = new MemoryLsnStore();

    await new CompositeLsnStore([failing, working]).save("slot", "0/99");
    await expect(working.load("slot")).resolves.toBe("0/99");
  });

  it("round-trips the on-disk checkpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cdc-lsn-"));
    try {
      const store = new FileLsnStore(
        join(directory, "state", "slot.lsn.json"),
      );

      await expect(store.load("slot")).resolves.toBeNull();
      await store.save("slot", "0/ABC");
      await expect(store.load("slot")).resolves.toBe("0/ABC");
      await expect(store.load("other")).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Redis Stream publishing + idempotency
// ---------------------------------------------------------------------------

class FakeRedis implements CdcRedisLike {
  readonly values = new Map<string, string>();
  readonly entries: Array<Record<string, string | number>> = [];
  failXadd = false;

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; ex?: number },
  ) {
    if (options?.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async del(key: string | string[]) {
    for (const single of Array.isArray(key) ? key : [key]) {
      this.values.delete(single);
    }
    return 1;
  }

  async xadd(
    key: string,
    _id: string,
    fields: Record<string, string | number>,
  ) {
    expect(key).toBe(CDC_STREAM_KEY);
    if (this.failXadd) throw new Error("xadd failed");
    this.entries.push(fields);
    return `${this.entries.length}-0`;
  }
}

function makeEvent(index = 0): CdcChangeEvent {
  const event = transformCdcChange(
    {
      schema: "public",
      table: "Booking",
      operation: "INSERT",
      old: null,
      new: { id: index },
      txId: null,
    },
    { slot: "slot", lsn: "0/16B374D8", index, receivedAt: Date.now() },
  );

  if (!event) throw new Error("fixture was filtered out");
  return event;
}

describe("CdcStreamPublisher", () => {
  it("appends one entry and marks the event as done", async () => {
    const redis = new FakeRedis();
    const publisher = createCdcPublisher({ redis, slot: "slot" });
    const event = makeEvent();

    const result = await publisher.publish(event);

    expect(result).toMatchObject({ published: true, streamId: "1-0" });
    expect(redis.entries).toHaveLength(1);
    expect(redis.values.get(`cdc:processed:slot:${event.id}`)).toBe("done");
  });

  it("skips an event that was already completed", async () => {
    const redis = new FakeRedis();
    const publisher = createCdcPublisher({ redis, slot: "slot" });
    const event = makeEvent();

    await publisher.publish(event);
    const duplicate = await publisher.publish({ ...event });

    expect(duplicate).toMatchObject({ published: false, duplicate: true });
    expect(redis.entries).toHaveLength(1);
  });

  it("republishes an event whose previous attempt died before XADD", async () => {
    const redis = new FakeRedis();
    const publisher = createCdcPublisher({ redis, slot: "slot" });
    const event = makeEvent(1);
    redis.values.set(`cdc:processed:slot:${event.id}`, "pending");

    const result = await publisher.publish({ ...event });

    expect(result.published).toBe(true);
    expect(redis.entries).toHaveLength(1);
  });

  it("releases the claim when XADD fails so the event is retried", async () => {
    const redis = new FakeRedis();
    redis.failXadd = true;
    const publisher = createCdcPublisher({ redis, slot: "slot" });
    const event = makeEvent(2);

    await expect(publisher.publish({ ...event })).rejects.toThrow("xadd failed");
    expect(redis.values.has(`cdc:processed:slot:${event.id}`)).toBe(false);

    redis.failXadd = false;
    await expect(publisher.publish({ ...event })).resolves.toMatchObject({
      published: true,
    });
  });

  it("reports Redis unavailability instead of dropping silently", async () => {
    const publisher = createCdcPublisher({ redis: null, slot: "slot" });

    await expect(publisher.publish(makeEvent(3))).resolves.toEqual({
      published: false,
      reason: "redis_unavailable",
    });
  });
});
