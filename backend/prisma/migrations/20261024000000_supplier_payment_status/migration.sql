-- Whether a purchase has been paid to the supplier, and which purchase a payment settled.
ALTER TABLE "Purchase" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID';
--> statement-breakpoint
ALTER TABLE "Purchase" ADD COLUMN "paidAt" DATETIME;
--> statement-breakpoint
ALTER TABLE "SupplierPayment" ADD COLUMN "purchaseId" TEXT;
