import { deleteFolderWithRelations } from "@/lib/folders";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// PrismaClientKnownRequestError is a stable runtime export unrelated to the
// generated model types, but importing "@prisma/client" still requires the
// generated `.prisma/client` package to exist on disk (via `prisma generate`,
// which needs network access to Prisma's engine binaries). Stub it directly
// so this test suite can run without that generation step.
jest.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(
        message: string,
        opts: { code: string; clientVersion: string },
      ) {
        super(message);
        this.name = "PrismaClientKnownRequestError";
        this.code = opts.code;
      }
    },
  },
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

function makeConflictError() {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: "test" },
  );
}

describe("deleteFolderWithRelations", () => {
  const mockTransaction = prisma.$transaction as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deletes each folderVenue batch in its own short, isolated transaction", async () => {
    const findMany = jest
      .fn()
      // first pass: 50 rows, second: 10, then done
      .mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, i) => ({ id: `v${i}` })),
      )
      .mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => ({ id: `v${i + 50}` })),
      )
      .mockResolvedValueOnce([]);

    const deleteManyVenues = jest.fn().mockResolvedValue({ count: 50 });
    const deleteManyMembers = jest.fn().mockResolvedValue({ count: 2 });
    const deleteManyUpvotes = jest.fn().mockResolvedValue({ count: 1 });
    const deleteFolder = jest.fn().mockResolvedValue({ id: "folder-1" });

    const tx = {
      folderVenue: { findMany, deleteMany: deleteManyVenues },
      folderMember: { deleteMany: deleteManyMembers },
      folderUpvote: { deleteMany: deleteManyUpvotes },
      folder: { delete: deleteFolder },
    };

    mockTransaction.mockImplementation(async (fn: any, options: any) => {
      expect(options).toEqual({
        maxWait: 5_000,
        timeout: 10_000,
        isolationLevel: "ReadCommitted",
      });
      return fn(tx);
    });

    await deleteFolderWithRelations("folder-1");

    // 3 venue-batch transactions (2 with rows + 1 empty to stop) + 1 for
    // members/upvotes + 1 for the folder delete itself = 5 short transactions,
    // instead of one long-held transaction spanning everything.
    expect(mockTransaction).toHaveBeenCalledTimes(5);

    expect(findMany).toHaveBeenCalledTimes(3);
    expect(deleteManyVenues).toHaveBeenCalledTimes(2);
    expect(deleteManyVenues).toHaveBeenNthCalledWith(1, {
      where: { id: { in: Array.from({ length: 50 }, (_, i) => `v${i}`) } },
    });
    expect(deleteManyVenues).toHaveBeenNthCalledWith(2, {
      where: {
        id: { in: Array.from({ length: 10 }, (_, i) => `v${i + 50}`) },
      },
    });
    expect(deleteManyMembers).toHaveBeenCalledWith({
      where: { folderId: "folder-1" },
    });
    expect(deleteManyUpvotes).toHaveBeenCalledWith({
      where: { folderId: "folder-1" },
    });
    expect(deleteFolder).toHaveBeenCalledWith({ where: { id: "folder-1" } });
  });

  it("retries a batch that fails with a transient write conflict (P2034)", async () => {
    let attempts = 0;
    mockTransaction.mockImplementation(async (fn: any) => {
      attempts += 1;
      if (attempts < 3) throw makeConflictError();
      return fn({
        folderVenue: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
        },
        folderMember: { deleteMany: jest.fn() },
        folderUpvote: { deleteMany: jest.fn() },
        folder: { delete: jest.fn().mockResolvedValue({ id: "folder-1" }) },
      });
    });

    await expect(
      deleteFolderWithRelations("folder-1"),
    ).resolves.toBeUndefined();
    expect(attempts).toBeGreaterThanOrEqual(3);
  });

  it("gives up and rethrows after exceeding the retry limit", async () => {
    mockTransaction.mockImplementation(async () => {
      throw makeConflictError();
    });

    await expect(deleteFolderWithRelations("folder-1")).rejects.toThrow(
      /write conflict/,
    );
    // 1 initial attempt + 3 retries = 4 calls before giving up
    expect(mockTransaction).toHaveBeenCalledTimes(4);
  });

  it("does not retry non-conflict errors", async () => {
    mockTransaction.mockImplementation(async () => {
      throw new Error("some other db error");
    });

    await expect(deleteFolderWithRelations("folder-1")).rejects.toThrow(
      "some other db error",
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
