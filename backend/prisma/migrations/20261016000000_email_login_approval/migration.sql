-- Email login approval replaces authenticator-app two-factor.
-- Users who had two-factor switched on keep a second step: they are opted in to email approval.
ALTER TABLE "User" ADD COLUMN "emailApprovalEnabled" BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "User" SET "emailApprovalEnabled" = "twoFactorEnabled";
--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";
--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "twoFactorSecret";
--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "twoFactorRecovery";
--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "twoFactorLastStep";
--> statement-breakpoint
DROP TABLE IF EXISTS "LoginApproval";
--> statement-breakpoint
-- CreateTable
CREATE TABLE "LoginApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sentTo" TEXT NOT NULL,
    "approveTokenHash" TEXT NOT NULL,
    "rejectTokenHash" TEXT NOT NULL,
    "pollTokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'COMPLETED', 'FAILED')),
    "expiresAt" DATETIME NOT NULL,
    "decidedAt" DATETIME,
    "claimUntil" DATETIME,
    "claimedAt" DATETIME,
    "tokenVersion" INTEGER NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "LoginApproval_approveTokenHash_key" ON "LoginApproval"("approveTokenHash");
--> statement-breakpoint
CREATE UNIQUE INDEX "LoginApproval_rejectTokenHash_key" ON "LoginApproval"("rejectTokenHash");
--> statement-breakpoint
CREATE UNIQUE INDEX "LoginApproval_pollTokenHash_key" ON "LoginApproval"("pollTokenHash");
--> statement-breakpoint
CREATE INDEX "LoginApproval_userId_status_idx" ON "LoginApproval"("userId", "status");
--> statement-breakpoint
CREATE INDEX "LoginApproval_status_expiresAt_idx" ON "LoginApproval"("status", "expiresAt");
