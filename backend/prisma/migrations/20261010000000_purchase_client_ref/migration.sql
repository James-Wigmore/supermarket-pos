-- Idempotency key so a repeated delivery request cannot receive the same stock twice.
ALTER TABLE "Purchase" ADD COLUMN "clientRef" TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX "Purchase_clientRef_key" ON "Purchase"("clientRef");
