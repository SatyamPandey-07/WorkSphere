import {
  sortTagIdsDeterministically,
  syncFavoriteTagsBulk,
} from "@/lib/favoriteTagSync";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    favoriteTag: {
      update: jest.fn((args: unknown) => ({ __op: "update", args })),
    },
  },
}));

describe("sortTagIdsDeterministically", () => {
  it("returns tag ids in lexicographic order", () => {
    expect(
      sortTagIdsDeterministically(["tag-c", "tag-a", "tag-b"]),
    ).toEqual(["tag-a", "tag-b", "tag-c"]);
  });

  it("does not mutate the input array", () => {
    const input = ["z", "a"];
    sortTagIdsDeterministically(input);
    expect(input).toEqual(["z", "a"]);
  });
});

describe("syncFavoriteTagsBulk", () => {
  const mockTransaction = prisma.$transaction as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (ops: unknown[]) => ops);
  });

  it("returns an empty array without opening a transaction", async () => {
    await expect(syncFavoriteTagsBulk([])).resolves.toEqual([]);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("passes FavoriteTag updates to $transaction in sorted id order", async () => {
    await syncFavoriteTagsBulk([
      { id: "tag-c", name: "C" },
      { id: "tag-a", color: "#111111" },
      { id: "tag-b", name: "B", color: "#222222" },
    ]);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const ops = mockTransaction.mock.calls[0][0] as Array<{
      args: { where: { id: string }; data: Record<string, string> };
    }>;

    expect(ops.map((op) => op.args.where.id)).toEqual([
      "tag-a",
      "tag-b",
      "tag-c",
    ]);
    expect(ops[0].args.data).toEqual({ color: "#111111" });
    expect(ops[1].args.data).toEqual({ name: "B", color: "#222222" });
    expect(ops[2].args.data).toEqual({ name: "C" });
  });

  it("dedupes duplicate tag ids keeping the last payload", async () => {
    await syncFavoriteTagsBulk([
      { id: "tag-a", name: "First" },
      { id: "tag-a", name: "Second", color: "#abcdef" },
    ]);

    const ops = mockTransaction.mock.calls[0][0] as Array<{
      args: { where: { id: string }; data: Record<string, string> };
    }>;

    expect(ops).toHaveLength(1);
    expect(ops[0].args).toEqual({
      where: { id: "tag-a" },
      data: { name: "Second", color: "#abcdef" },
    });
  });
});
