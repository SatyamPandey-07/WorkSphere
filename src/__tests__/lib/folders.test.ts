import { deleteFolderWithRelations } from "@/lib/folders";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

describe("deleteFolderWithRelations", () => {
  const mockTransaction = prisma.$transaction as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("batches folderVenue deletes inside a timed transaction", async () => {
    const findMany = jest
      .fn()
      // first pass: 50 rows, second: 10, then done
      .mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, i) => ({ id: `fv-${i}` })),
      )
      .mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => ({ id: `fv-extra-${i}` })),
      )
      .mockResolvedValueOnce([]);

    const deleteManyVenues = jest.fn().mockResolvedValue({ count: 50 });
    const deleteManyMembers = jest.fn().mockResolvedValue({ count: 2 });
    const deleteManyUpvotes = jest.fn().mockResolvedValue({ count: 1 });
    const deleteFolder = jest.fn().mockResolvedValue({ id: "folder-1" });

    mockTransaction.mockImplementation(async (fn: any, options: any) => {
      expect(options).toEqual({ maxWait: 10_000, timeout: 30_000 });
      return fn({
        folderVenue: {
          findMany,
          deleteMany: deleteManyVenues,
        },
        folderMember: { deleteMany: deleteManyMembers },
        folderUpvote: { deleteMany: deleteManyUpvotes },
        folder: { delete: deleteFolder },
      });
    });

    await deleteFolderWithRelations("folder-1");

    expect(findMany).toHaveBeenCalledTimes(3);
    expect(deleteManyVenues).toHaveBeenCalledTimes(2);
    expect(deleteManyVenues).toHaveBeenNthCalledWith(1, {
      where: { id: { in: expect.arrayContaining(["fv-0", "fv-49"]) } },
    });
    expect(deleteManyMembers).toHaveBeenCalledWith({
      where: { folderId: "folder-1" },
    });
    expect(deleteManyUpvotes).toHaveBeenCalledWith({
      where: { folderId: "folder-1" },
    });
    expect(deleteFolder).toHaveBeenCalledWith({ where: { id: "folder-1" } });
  });
});
