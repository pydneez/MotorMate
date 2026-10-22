-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE 'SKIPPED';

-- AlterTable
ALTER TABLE "NotificationLog" ALTER COLUMN "recipientEmail" DROP NOT NULL;

