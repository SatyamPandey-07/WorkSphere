CREATE TABLE "FoodValidation" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "foodItem" TEXT NOT NULL,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FoodValidation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FoodVote" (
    "id" TEXT NOT NULL,
    "validationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FoodValidation_venueId_foodItem_key"
ON "FoodValidation"("venueId","foodItem");

CREATE UNIQUE INDEX "FoodVote_userId_validationId_key"
ON "FoodVote"("userId","validationId");

ALTER TABLE "FoodValidation"
ADD CONSTRAINT "FoodValidation_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FoodVote"
ADD CONSTRAINT "FoodVote_validationId_fkey"
FOREIGN KEY ("validationId") REFERENCES "FoodValidation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;