/*
  Warnings:

  - You are about to drop the column `finishedAt` on the `RenderJob` table. All the data in the column will be lost.
  - You are about to drop the column `startedAt` on the `RenderJob` table. All the data in the column will be lost.
  - Made the column `userEmail` on table `RenderJob` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "public"."RenderJob" DROP CONSTRAINT "RenderJob_userId_fkey";

-- DropIndex
DROP INDEX "public"."RenderJob_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "public"."RenderJob" DROP COLUMN "finishedAt",
DROP COLUMN "startedAt",
ALTER COLUMN "userEmail" SET NOT NULL,
ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."RenderJob" ADD CONSTRAINT "RenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
