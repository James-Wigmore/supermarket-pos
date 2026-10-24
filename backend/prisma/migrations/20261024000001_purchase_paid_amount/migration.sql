-- How much of a purchase has been paid, so lump-sum supplier payments can settle purchases oldest first.
ALTER TABLE "Purchase" ADD COLUMN "paidAmount" DECIMAL NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "Purchase" SET "paidAmount" = "total" WHERE "paymentStatus" = 'PAID';
