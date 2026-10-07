-- CreateTable
CREATE TABLE "SyncState" (
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "changedAt" DATETIME NOT NULL,
    "remoteRef" TEXT,
    "remoteHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "error" TEXT,
    PRIMARY KEY ("entity", "recordId")
);
--> statement-breakpoint
CREATE INDEX "SyncState_status_entity_idx" ON "SyncState"("status", "entity");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL,
    "entity" TEXT,
    "recordId" TEXT,
    "message" TEXT NOT NULL,
    "local" JSONB,
    "sheet" JSONB,
    "resolution" TEXT,
    "resolvedAt" DATETIME,
    "pushedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX "SyncLog_level_resolution_idx" ON "SyncLog"("level", "resolution");
--> statement-breakpoint
CREATE INDEX "SyncLog_pushedAt_idx" ON "SyncLog"("pushedAt");
--> statement-breakpoint
-- Every insert/update of a synchronised table queues the record for Google Sheets.
--> statement-breakpoint
CREATE TRIGGER "sync_Product_i" AFTER INSERT ON "Product"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Product', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Product_u" AFTER UPDATE ON "Product"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Product', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Category_i" AFTER INSERT ON "Category"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Category', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Category_u" AFTER UPDATE ON "Category"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Category', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_StockLevel_i" AFTER INSERT ON "StockLevel"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('StockLevel', NEW."productId" || ':' || NEW."branchId", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_StockLevel_u" AFTER UPDATE ON "StockLevel"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('StockLevel', NEW."productId" || ':' || NEW."branchId", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_StockMovement_i" AFTER INSERT ON "StockMovement"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('StockMovement', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_StockMovement_u" AFTER UPDATE ON "StockMovement"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('StockMovement', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Sale_i" AFTER INSERT ON "Sale"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Sale', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Sale_u" AFTER UPDATE ON "Sale"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Sale', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_SaleItem_i" AFTER INSERT ON "SaleItem"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('SaleItem', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_SaleItem_u" AFTER UPDATE ON "SaleItem"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('SaleItem', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Payment_i" AFTER INSERT ON "Payment"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Payment', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Payment_u" AFTER UPDATE ON "Payment"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Payment', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Purchase_i" AFTER INSERT ON "Purchase"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Purchase', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Purchase_u" AFTER UPDATE ON "Purchase"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Purchase', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_PurchaseItem_i" AFTER INSERT ON "PurchaseItem"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('PurchaseItem', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_PurchaseItem_u" AFTER UPDATE ON "PurchaseItem"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('PurchaseItem', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Supplier_i" AFTER INSERT ON "Supplier"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Supplier', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Supplier_u" AFTER UPDATE ON "Supplier"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Supplier', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Customer_i" AFTER INSERT ON "Customer"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Customer', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Customer_u" AFTER UPDATE ON "Customer"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Customer', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Return_i" AFTER INSERT ON "Return"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Return', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Return_u" AFTER UPDATE ON "Return"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Return', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_ReturnItem_i" AFTER INSERT ON "ReturnItem"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('ReturnItem', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_ReturnItem_u" AFTER UPDATE ON "ReturnItem"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('ReturnItem', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Promotion_i" AFTER INSERT ON "Promotion"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Promotion', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Promotion_u" AFTER UPDATE ON "Promotion"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Promotion', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_User_i" AFTER INSERT ON "User"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('User', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_User_u" AFTER UPDATE ON "User"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('User', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Branch_i" AFTER INSERT ON "Branch"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Branch', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Branch_u" AFTER UPDATE ON "Branch"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Branch', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Register_i" AFTER INSERT ON "Register"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Register', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Register_u" AFTER UPDATE ON "Register"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Register', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_CashierSession_i" AFTER INSERT ON "CashierSession"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('CashierSession', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_CashierSession_u" AFTER UPDATE ON "CashierSession"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('CashierSession', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Expense_i" AFTER INSERT ON "Expense"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Expense', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Expense_u" AFTER UPDATE ON "Expense"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Expense', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Setting_i" AFTER INSERT ON "Setting"
  WHEN NEW."key" NOT LIKE 'sync.%'
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Setting', NEW."key", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Setting_u" AFTER UPDATE ON "Setting"
  WHEN NEW."key" NOT LIKE 'sync.%'
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Setting', NEW."key", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_AuditLog_i" AFTER INSERT ON "AuditLog"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('AuditLog', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_AuditLog_u" AFTER UPDATE ON "AuditLog"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('AuditLog', NEW."id", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Barcode_i" AFTER INSERT ON "Barcode"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Product', NEW."productId", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_Barcode_u" AFTER UPDATE ON "Barcode"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Product', NEW."productId", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
CREATE TRIGGER "sync_PriceHistory_i" AFTER INSERT ON "PriceHistory"
BEGIN
  INSERT INTO "SyncState" ("entity", "recordId", "status", "changedAt") VALUES ('Product', NEW."productId", 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
  ON CONFLICT ("entity", "recordId") DO UPDATE SET "status" = CASE WHEN "status" = 'CONFLICT' THEN 'CONFLICT' ELSE 'PENDING' END, "changedAt" = excluded."changedAt";
END;
--> statement-breakpoint
-- Renaming a category changes the category column of its products.
CREATE TRIGGER "sync_Category_products" AFTER UPDATE OF "name" ON "Category"
BEGIN
  UPDATE "SyncState" SET "status" = 'PENDING', "changedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00','now')
  WHERE "entity" = 'Product' AND "status" != 'CONFLICT' AND "recordId" IN (SELECT "id" FROM "Product" WHERE "categoryId" = NEW."id");
END;
