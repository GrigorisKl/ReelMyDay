/*
  Warnings:

  - The values [queued,working,done,failed] on the enum `RenderJobStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `payload` on the `RenderJob` table. All the data in the column will be lost.
  - The `status` column on the `RenderJob` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `items` to the `RenderJob` table without a default value. This is not possible if the table is not empty.
  - Added the required column `options` to the `RenderJob` table without a default value. This is not possible if the table is not empty.
  - Made the column `userId` on table `RenderJob` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."RenderJobStatus_new" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');
ALTER TABLE "public"."RenderJob" ALTER COLUMN "status" TYPE "public"."RenderJobStatus_new" USING ("status"::text::"public"."RenderJobStatus_new");
ALTER TYPE "public"."RenderJobStatus" RENAME TO "RenderJobStatus_old";
ALTER TYPE "public"."RenderJobStatus_new" RENAME TO "RenderJobStatus";
DROP TYPE "public"."RenderJobStatus_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."RenderJob" DROP CONSTRAINT "RenderJob_userId_fkey";

-- AlterTable
ALTER TABLE "public"."RenderJob" DROP COLUMN "payload",
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "items" JSONB NOT NULL,
ADD COLUMN     "options" JSONB NOT NULL,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ALTER COLUMN "userEmail" DROP NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "public"."RenderJobStatus" NOT NULL DEFAULT 'QUEUED',
ALTER COLUMN "userId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "RenderJob_userId_createdAt_idx" ON "public"."RenderJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RenderJob_status_createdAt_idx" ON "public"."RenderJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."RenderJob" ADD CONSTRAINT "RenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
