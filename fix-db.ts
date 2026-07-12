import { prisma } from "./src/lib/prisma";

async function main() {
  await prisma.$executeRawUnsafe('ALTER TABLE "UserMemory" ALTER COLUMN embedding TYPE vector(1024);');
  await prisma.$executeRawUnsafe('ALTER TABLE "SemanticCache" ALTER COLUMN embedding TYPE vector(1024);');
  console.log("Successfully fixed DB embeddings dimensions to 1024");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
