-- Two-factor authentication: the secret is stored encrypted, recovery codes only as keyed hashes.
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "twoFactorSecret" TEXT;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "twoFactorRecovery" TEXT;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "twoFactorLastStep" INTEGER;
