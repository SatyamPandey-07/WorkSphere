/**
 * @jest-environment node
 *
 * Passkey rotation / rename / revoke with email OTP step-up (#1991).
 * Uses an in-memory Prisma fake so the full issue → email → verify →
 * consume → replay flow runs against real route + library code.
 */
import nodemailer from "nodemailer";
import { auth } from "@clerk/nextjs/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { POST as sendOtp } from "@/app/api/auth/passkey/otp/route";
import {
  PATCH as renamePasskey,
  DELETE as revokePasskey,
} from "@/app/api/auth/passkey/credentials/[id]/route";
import { POST as rotationAction } from "@/app/api/auth/passkey/rotation/route";
import {
  OTP_MAX_ATTEMPTS,
  OtpDeliveryError,
  consumePasskeyOtp,
  generateOtpCode,
  hashOtpCode,
  issuePasskeyOtp,
  maskEmail,
  verifyPasskeyOtp,
} from "@/lib/passkey/emailOtp";
import { resetRateLimit } from "@/lib/rateLimit";

// ─── In-memory Prisma fake ────────────────────────────────────────────────────

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let seq = 0;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value?.getTime() === cond.getTime();
    if (typeof cond === "object") {
      if ("lt" in cond && !(value < cond.lt)) return false;
      if ("gt" in cond && !(value > cond.gt)) return false;
      if ("not" in cond && value === cond.not) return false;
      return true;
    }
    return value === cond;
  });
}

function apply(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) {
      row[key] += value.increment;
    } else {
      row[key] = value;
    }
  }
}

/** Honour Prisma `select` so responses carry exactly what real queries return. */
function pick(row: Row, select?: Row): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

function model(name: string, defaults: () => Row = () => ({})) {
  const rows = () => (tables[name] ??= []);
  return {
    create: jest.fn(async ({ data, select }: { data: Row; select?: Row }) => {
      seq += 1;
      const row = {
        id: `${name}_${seq}`,
        createdAt: new Date(Date.now() + seq),
        ...defaults(),
        ...data,
      };
      rows().push(row);
      return pick(row, select);
    }),
    findFirst: jest.fn(async ({ where, orderBy, select }: { where?: Row; orderBy?: Row; select?: Row } = {}) => {
      let found = rows().filter((r) => matches(r, where));
      if (orderBy?.createdAt === "desc") {
        found = [...found].sort((a, b) => b.createdAt - a.createdAt);
      }
      return found[0] ? pick(found[0], select) : null;
    }),
    findUnique: jest.fn(async ({ where, select }: { where: Row; select?: Row }) => {
      const row = rows().find((r) => matches(r, where));
      return row ? pick(row, select) : null;
    }),
    findMany: jest.fn(async ({ where }: { where?: Row } = {}) =>
      rows().filter((r) => matches(r, where)).map((r) => ({ ...r })),
    ),
    update: jest.fn(async ({ where, data, select }: { where: Row; data: Row; select?: Row }) => {
      const row = rows().find((r) => matches(r, where));
      if (!row) throw new Error(`${name} not found`);
      apply(row, data);
      return pick(row, select);
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows().filter((r) => matches(r, where));
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    }),
    delete: jest.fn(async ({ where }: { where: Row }) => {
      const idx = rows().findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error(`${name} not found`);
      return rows().splice(idx, 1)[0];
    }),
    deleteMany: jest.fn(async ({ where }: { where: Row }) => {
      const keep = rows().filter((r) => !matches(r, where));
      const count = rows().length - keep.length;
      tables[name] = keep;
      return { count };
    }),
  };
}

const mockPrisma = {
  user: model("user"),
  passkeyCredential: model("passkeyCredential"),
  passkeyChallenge: model("passkeyChallenge"),
  passkeyEmailOtp: model("passkeyEmailOtp", () => ({ attempts: 0, consumedAt: null })),
  $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};

// Lazy getter: jest.mock is hoisted above the fake's definition.
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return mockPrisma;
  },
}));
jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("@simplewebauthn/server", () => ({ verifyRegistrationResponse: jest.fn() }));
jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

// ─── Fixtures & helpers ───────────────────────────────────────────────────────

const USER = "user_alice";
const OTHER_USER = "user_mallory";
const sendMail = jest.fn();

function signIn(userId: string | null) {
  (auth as unknown as jest.Mock).mockResolvedValue({ userId });
}

function seed() {
  for (const key of Object.keys(tables)) delete tables[key];
  tables.user = [
    { id: USER, email: "alice.smith@example.com" },
    { id: OTHER_USER, email: "mallory@example.com" },
  ];
  tables.passkeyCredential = [
    { id: "pk_alice", userId: USER, credentialId: "cred-a", name: "Work MacBook", createdAt: new Date(0) },
    { id: "pk_mallory", userId: OTHER_USER, credentialId: "cred-m", name: "Mallory Key", createdAt: new Date(0) },
  ];
  tables.passkeyChallenge = [
    { id: "chal_1", userId: USER, challenge: "c1", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() },
  ];
}

/** The code exactly as the user would read it from the email. */
function lastEmailedCode(): string {
  const text: string = sendMail.mock.calls.at(-1)[0].text;
  return text.match(/\b(\d{6})\b/)![1];
}

const json = (body: unknown, method = "POST") =>
  ({
    method,
    headers: { "Content-Type": "application/json", host: "localhost:3000" },
    body: JSON.stringify(body),
  }) as RequestInit;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function requestCode(action: string, credentialId = "pk_alice") {
  resetRateLimit(); // isolate from the resend cooldown
  const res = await sendOtp(new Request("http://localhost:3000/api/auth/passkey/otp", json({ action, credentialId })));
  expect(res.status).toBe(200);
  return lastEmailedCode();
}

const rename = (id: string, body: unknown) =>
  renamePasskey(new Request(`http://localhost:3000/api/auth/passkey/credentials/${id}`, json(body, "PATCH")), params(id));
const revoke = (id: string, body: unknown) =>
  revokePasskey(new Request(`http://localhost:3000/api/auth/passkey/credentials/${id}`, json(body, "DELETE")), params(id));
const rotate = (body: unknown) =>
  rotationAction(new Request("http://localhost:3000/api/auth/passkey/rotation", json(body)));

const FAKE_REGISTRATION = { id: "new", rawId: "new", response: {}, type: "public-key" };

function mockWebAuthnSuccess() {
  (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: "cred-new", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
      aaguid: "aaguid-1",
    },
  });
}

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  seed();
  resetRateLimit();
  process.env = { ...originalEnv, SMTP_USER: "mailer@worksphere.test", SMTP_PASS: "secret", CSRF_SECRET: "test-secret" };
  sendMail.mockResolvedValue({});
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  signIn(USER);
});

afterAll(() => {
  process.env = originalEnv;
});

// ─── Library ──────────────────────────────────────────────────────────────────

describe("emailOtp library", () => {
  it("generates zero-padded 6-digit codes", () => {
    const codes = new Set(Array.from({ length: 200 }, generateOtpCode));
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(190);
  });

  it("binds the hash to user, action and credential", () => {
    const scope = { userId: USER, action: "rename" as const, credentialId: "pk_alice" };
    const base = hashOtpCode("123456", scope);
    expect(hashOtpCode("123456", scope)).toBe(base);
    expect(hashOtpCode("123456", { ...scope, action: "revoke" })).not.toBe(base);
    expect(hashOtpCode("123456", { ...scope, credentialId: "pk_other" })).not.toBe(base);
    expect(hashOtpCode("123456", { ...scope, userId: OTHER_USER })).not.toBe(base);
  });

  it("masks email addresses", () => {
    expect(maskEmail("alice.smith@example.com")).toBe("a•••h@example.com");
    expect(maskEmail("ab@x.io")).toBe("a•••@x.io");
    expect(maskEmail("not-an-email")).toBe("•••");
  });

  it("stores only a hash and emails the code", async () => {
    await issuePasskeyOtp({ userId: USER, email: "alice.smith@example.com", action: "rename", credentialId: "pk_alice", passkeyName: "Work MacBook" });
    const code = lastEmailedCode();
    const [row] = tables.passkeyEmailOtp;
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.codeHash).toBe(hashOtpCode(code, { userId: USER, action: "rename", credentialId: "pk_alice" }));
    expect(sendMail.mock.calls[0][0].to).toBe("alice.smith@example.com");
  });

  it("escapes the passkey name in the HTML email", async () => {
    await issuePasskeyOtp({ userId: USER, email: "a@b.co", action: "revoke", credentialId: "pk_alice", passkeyName: "<img src=x onerror=alert(1)>" });
    const { html } = sendMail.mock.calls[0][0];
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("invalidates the previous code when a new one is issued", async () => {
    const base = { userId: USER, email: "a@b.co", action: "rename" as const, credentialId: "pk_alice", passkeyName: "k" };
    await issuePasskeyOtp(base);
    const first = lastEmailedCode();
    await issuePasskeyOtp(base);
    const second = lastEmailedCode();

    const scope = { userId: USER, action: "rename" as const, credentialId: "pk_alice" };
    if (first !== second) {
      expect((await verifyPasskeyOtp({ ...scope, code: first })).ok).toBe(false);
    }
    expect((await verifyPasskeyOtp({ ...scope, code: second })).ok).toBe(true);
  });

  it("verifies once and refuses replay after consumption", async () => {
    await issuePasskeyOtp({ userId: USER, email: "a@b.co", action: "rename", credentialId: "pk_alice", passkeyName: "k" });
    const scope = { userId: USER, action: "rename" as const, credentialId: "pk_alice" };
    const result = await verifyPasskeyOtp({ ...scope, code: lastEmailedCode() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await consumePasskeyOtp(result.otpId)).toBe(true);
    expect(await consumePasskeyOtp(result.otpId)).toBe(false);
    expect(await verifyPasskeyOtp({ ...scope, code: lastEmailedCode() })).toEqual({ ok: false, reason: "missing" });
  });

  it("locks after the maximum number of wrong guesses, even for the right code", async () => {
    await issuePasskeyOtp({ userId: USER, email: "a@b.co", action: "revoke", credentialId: "pk_alice", passkeyName: "k" });
    const code = lastEmailedCode();
    const wrong = code === "000000" ? "111111" : "000000";
    const scope = { userId: USER, action: "revoke" as const, credentialId: "pk_alice" };

    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await verifyPasskeyOtp({ ...scope, code: wrong })).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await verifyPasskeyOtp({ ...scope, code: wrong })).toEqual({ ok: false, reason: "locked" });
    expect(await verifyPasskeyOtp({ ...scope, code })).toEqual({ ok: false, reason: "locked" });
  });

  it("caps concurrent guesses at the attempt limit", async () => {
    await issuePasskeyOtp({ userId: USER, email: "a@b.co", action: "revoke", credentialId: "pk_alice", passkeyName: "k" });
    const scope = { userId: USER, action: "revoke" as const, credentialId: "pk_alice" };
    await Promise.all(Array.from({ length: 20 }, () => verifyPasskeyOtp({ ...scope, code: "999999" })));
    expect(tables.passkeyEmailOtp[0].attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it("rejects expired and malformed codes", async () => {
    await issuePasskeyOtp({ userId: USER, email: "a@b.co", action: "rename", credentialId: "pk_alice", passkeyName: "k" });
    const scope = { userId: USER, action: "rename" as const, credentialId: "pk_alice" };
    expect(await verifyPasskeyOtp({ ...scope, code: "12ab56" })).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyPasskeyOtp({ ...scope, code: 123456 })).toEqual({ ok: false, reason: "invalid" });

    tables.passkeyEmailOtp[0].expiresAt = new Date(Date.now() - 1);
    expect(await verifyPasskeyOtp({ ...scope, code: lastEmailedCode() })).toEqual({ ok: false, reason: "expired" });
  });

  it("never logs codes in production and voids undeliverable codes", async () => {
    process.env = { ...process.env, NODE_ENV: "production", SMTP_USER: "", SMTP_PASS: "" };
    const log = jest.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      issuePasskeyOtp({ userId: USER, email: "a@b.co", action: "rename", credentialId: "pk_alice", passkeyName: "k" }),
    ).rejects.toBeInstanceOf(OtpDeliveryError);
    expect(log).not.toHaveBeenCalled();
    expect(tables.passkeyEmailOtp[0].consumedAt).toBeInstanceOf(Date);
    log.mockRestore();
  });
});

// ─── POST /api/auth/passkey/otp ───────────────────────────────────────────────

describe("POST /api/auth/passkey/otp", () => {
  const send = (body: unknown) =>
    sendOtp(new Request("http://localhost:3000/api/auth/passkey/otp", json(body)));

  it("requires authentication", async () => {
    signIn(null);
    expect((await send({ action: "rename", credentialId: "pk_alice" })).status).toBe(401);
  });

  it("validates the action", async () => {
    expect((await send({ action: "delete-everything", credentialId: "pk_alice" })).status).toBe(400);
    expect((await send({ action: "rename" })).status).toBe(400);
  });

  it("refuses to issue codes for another user's passkey", async () => {
    const res = await send({ action: "revoke", credentialId: "pk_mallory" });
    expect(res.status).toBe(404);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("emails the account address and returns it masked", async () => {
    const res = await send({ action: "rotate", credentialId: "pk_alice", email: "attacker@evil.test" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sentTo).toBe("a•••h@example.com");
    expect(sendMail.mock.calls[0][0].to).toBe("alice.smith@example.com");
  });

  it("enforces a resend cooldown with Retry-After", async () => {
    expect((await send({ action: "rename", credentialId: "pk_alice" })).status).toBe(200);
    const res = await send({ action: "rename", credentialId: "pk_alice" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("returns 503 when email delivery is unavailable in production", async () => {
    process.env = { ...process.env, NODE_ENV: "production", SMTP_USER: "", SMTP_PASS: "" };
    expect((await send({ action: "rename", credentialId: "pk_alice" })).status).toBe(503);
  });
});

// ─── Rename / revoke ──────────────────────────────────────────────────────────

describe("PATCH /api/auth/passkey/credentials/[id] (rename)", () => {
  it("rejects a rename without a code", async () => {
    const res = await rename("pk_alice", { name: "Home iMac" });
    expect(res.status).toBe(403);
    expect(tables.passkeyCredential[0].name).toBe("Work MacBook");
  });

  it("renames with a valid code and refuses replay", async () => {
    const otp = await requestCode("rename");
    const res = await rename("pk_alice", { name: "  Home iMac  ", otp });
    expect(res.status).toBe(200);
    expect(tables.passkeyCredential[0].name).toBe("Home iMac");

    const replay = await rename("pk_alice", { name: "Hacked", otp });
    expect(replay.status).toBe(403);
    expect(tables.passkeyCredential[0].name).toBe("Home iMac");
  });

  it("does not accept a code issued for a different action", async () => {
    const otp = await requestCode("revoke");
    expect((await rename("pk_alice", { name: "X", otp })).status).toBe(403);
  });

  it("rejects wrong codes and overly long names", async () => {
    const otp = await requestCode("rename");
    const wrong = otp === "000000" ? "111111" : "000000";
    expect((await rename("pk_alice", { name: "X", otp: wrong })).status).toBe(403);
    expect((await rename("pk_alice", { name: "x".repeat(65), otp })).status).toBe(400);
  });

  it("404s for another user's passkey", async () => {
    expect((await rename("pk_mallory", { name: "Mine now", otp: "123456" })).status).toBe(404);
  });
});

describe("DELETE /api/auth/passkey/credentials/[id] (revoke)", () => {
  it("does not revoke without a valid code", async () => {
    expect((await revoke("pk_alice", {})).status).toBe(403);
    expect((await revoke("pk_alice", { otp: "123456" })).status).toBe(403);
    expect(tables.passkeyCredential.some((c) => c.id === "pk_alice")).toBe(true);
  });

  it("revokes with a valid code", async () => {
    const otp = await requestCode("revoke");
    expect((await revoke("pk_alice", { otp })).status).toBe(200);
    expect(tables.passkeyCredential.some((c) => c.id === "pk_alice")).toBe(false);
  });
});

// ─── Rotation ─────────────────────────────────────────────────────────────────

describe("POST /api/auth/passkey/rotation (rotate)", () => {
  it("requires a registration response", async () => {
    expect((await rotate({ action: "rotate", credentialId: "pk_alice", otp: "123456" })).status).toBe(400);
  });

  it("checks the code before running WebAuthn verification", async () => {
    const res = await rotate({ action: "rotate", credentialId: "pk_alice", otp: "123456", registrationResponse: FAKE_REGISTRATION });
    expect(res.status).toBe(403);
    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it("keeps the code usable if the WebAuthn ceremony fails, then rotates", async () => {
    const otp = await requestCode("rotate");

    (verifyRegistrationResponse as jest.Mock).mockRejectedValueOnce(new Error("bad attestation"));
    const failed = await rotate({ action: "rotate", credentialId: "pk_alice", otp, registrationResponse: FAKE_REGISTRATION });
    expect(failed.status).toBe(400);
    expect(tables.passkeyCredential.some((c) => c.id === "pk_alice")).toBe(true);

    mockWebAuthnSuccess();
    const res = await rotate({ action: "rotate", credentialId: "pk_alice", otp, registrationResponse: FAKE_REGISTRATION });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.revokedCredentialId).toBe("pk_alice");
    const alice = tables.passkeyCredential.filter((c) => c.userId === USER);
    expect(alice).toHaveLength(1);
    expect(alice[0]).toMatchObject({ credentialId: "cred-new", name: "Work MacBook", backedUp: true });
    expect(alice[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * 864e5);
    expect(tables.passkeyChallenge).toHaveLength(0);
  });

  it("cannot rotate twice with one code", async () => {
    const otp = await requestCode("rotate");
    mockWebAuthnSuccess();
    expect((await rotate({ action: "rotate", credentialId: "pk_alice", otp, registrationResponse: FAKE_REGISTRATION })).status).toBe(200);
    const newId = tables.passkeyCredential.find((c) => c.userId === USER)!.id;
    expect((await rotate({ action: "rotate", credentialId: newId, otp, registrationResponse: FAKE_REGISTRATION })).status).toBe(403);
  });

  it("404s when rotating another user's passkey", async () => {
    const res = await rotate({ action: "rotate", credentialId: "pk_mallory", otp: "123456", registrationResponse: FAKE_REGISTRATION });
    expect(res.status).toBe(404);
  });
});
