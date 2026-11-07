-- Step 15: many shops in one deployment.
-- Existing data becomes shop #1 ("shop_main", from the old ShopSettings row), its WO/INV
-- counters carry on from today's numbers, and every root table gets a shopId.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PLATFORM_ADMIN';

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "taxId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastWorkOrderNumber" INTEGER NOT NULL DEFAULT 0,
    "lastInvoiceNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- Shop #1 from the old settings row (or the defaults), numbering continued.
INSERT INTO "Shop" ("id", "name", "address", "phone", "email", "taxId", "lastWorkOrderNumber", "lastInvoiceNumber", "updatedAt")
SELECT 'shop_main',
       COALESCE(s."name", 'MotorMate Auto Service'),
       COALESCE(s."address", E'99 Soi Car Won''t Start, Road to Nowhere\nKhlong Luang, Pathum Thani 12120'),
       COALESCE(s."phone", '+6626767676'),
       s."email",
       COALESCE(s."taxId", '0-0000-00000-00-0'),
       COALESCE((SELECT MAX("number") FROM "WorkOrder"), 0),
       COALESCE((SELECT MAX("number") FROM "Invoice"), 0),
       CURRENT_TIMESTAMP
FROM (SELECT 1) AS one
LEFT JOIN "ShopSettings" s ON s."id" = 1;

-- DropTable
DROP TABLE "ShopSettings";

-- Columns: added nullable, filled with shop #1, then required.
ALTER TABLE "User" ADD COLUMN "shopId" TEXT, ADD COLUMN "lastShopId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "shopId" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shopId" TEXT;
ALTER TABLE "ServiceCatalogItem" ADD COLUMN "shopId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "shopId" TEXT;

UPDATE "User" SET "shopId" = 'shop_main' WHERE "role" IN ('ADMIN', 'ADVISOR', 'MECHANIC');
UPDATE "User" SET "lastShopId" = 'shop_main' WHERE "role" = 'CUSTOMER';
UPDATE "Customer" SET "shopId" = 'shop_main';
UPDATE "Vehicle" SET "shopId" = 'shop_main';
UPDATE "WorkOrder" SET "shopId" = 'shop_main';
UPDATE "Invoice" SET "shopId" = 'shop_main';
UPDATE "ServiceCatalogItem" SET "shopId" = 'shop_main';
UPDATE "InventoryItem" SET "shopId" = 'shop_main';

ALTER TABLE "Customer" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Vehicle" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "WorkOrder" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "ServiceCatalogItem" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "InventoryItem" ALTER COLUMN "shopId" SET NOT NULL;

-- Numbering comes from the shop's counters now, not a global sequence.
ALTER TABLE "WorkOrder" ALTER COLUMN "number" DROP DEFAULT;
DROP SEQUENCE "WorkOrder_number_seq";
ALTER TABLE "Invoice" ALTER COLUMN "number" DROP DEFAULT;
DROP SEQUENCE "Invoice_number_seq";

-- Uniques become per shop.
DROP INDEX "Customer_email_key";
DROP INDEX "Customer_userId_key";
DROP INDEX "Customer_phone_idx";
DROP INDEX "Vehicle_vin_key";
DROP INDEX "WorkOrder_number_key";
DROP INDEX "Invoice_number_key";
DROP INDEX "ServiceCatalogItem_name_key";
DROP INDEX "InventoryItem_sku_key";

CREATE UNIQUE INDEX "Customer_shopId_email_key" ON "Customer"("shopId", "email");
CREATE UNIQUE INDEX "Customer_shopId_userId_key" ON "Customer"("shopId", "userId");
CREATE INDEX "Customer_shopId_phone_idx" ON "Customer"("shopId", "phone");
CREATE UNIQUE INDEX "Vehicle_shopId_vin_key" ON "Vehicle"("shopId", "vin");
CREATE UNIQUE INDEX "WorkOrder_shopId_number_key" ON "WorkOrder"("shopId", "number");
CREATE UNIQUE INDEX "Invoice_shopId_number_key" ON "Invoice"("shopId", "number");
CREATE UNIQUE INDEX "ServiceCatalogItem_shopId_name_key" ON "ServiceCatalogItem"("shopId", "name");
CREATE UNIQUE INDEX "InventoryItem_shopId_sku_key" ON "InventoryItem"("shopId", "sku");
CREATE INDEX "User_shopId_idx" ON "User"("shopId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
