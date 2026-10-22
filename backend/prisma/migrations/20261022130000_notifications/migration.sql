-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_RESCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_CANCELLED';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "notifyConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyEmail" TEXT,
ADD COLUMN     "notifySubscriptionArn" TEXT;

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "subject" TEXT;

-- CreateIndex
CREATE INDEX "NotificationLog_customerId_idx" ON "NotificationLog"("customerId");

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

