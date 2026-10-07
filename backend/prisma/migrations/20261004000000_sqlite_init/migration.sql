-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "branchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
--> statement-breakpoint
CREATE INDEX "User_branchId_role_idx" ON "User"("branchId", "role");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Register" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Register_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Register_branchId_name_key" ON "Register"("branchId", "name");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "SupplierPayment_supplierId_createdAt_idx" ON "SupplierPayment"("supplierId", "createdAt");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "SupplierPrice" (
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitCost" DECIMAL NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("supplierId", "productId"),
    CONSTRAINT "SupplierPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "manufacturer" TEXT,
    "categoryId" TEXT,
    "supplierId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "packageSize" TEXT,
    "imageUrl" TEXT,
    "purchasePrice" DECIMAL NOT NULL DEFAULT 0,
    "taxRate" DECIMAL NOT NULL DEFAULT 0,
    "minStock" DECIMAL NOT NULL DEFAULT 0,
    "maxStock" DECIMAL,
    "tracksExpiry" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
--> statement-breakpoint
CREATE INDEX "Product_name_idx" ON "Product"("name");
--> statement-breakpoint
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
--> statement-breakpoint
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Barcode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Barcode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Barcode_code_key" ON "Barcode"("code");
--> statement-breakpoint
CREATE INDEX "Barcode_productId_idx" ON "Barcode"("productId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "ExternalProductCache" (
    "barcode" TEXT NOT NULL PRIMARY KEY,
    "data" JSONB NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "oldPrice" DECIMAL,
    "newPrice" DECIMAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "PriceHistory_productId_effectiveFrom_idx" ON "PriceHistory"("productId", "effectiveFrom");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "StockLevel" (
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL DEFAULT 0,
    PRIMARY KEY ("productId", "branchId"),
    CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockLevel_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "StockLevel_branchId_idx" ON "StockLevel"("branchId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "ProductBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "expiryDate" DATETIME,
    "quantity" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductBatch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ProductBatch_productId_branchId_batchNo_key" ON "ProductBatch"("productId", "branchId", "batchNo");
--> statement-breakpoint
CREATE INDEX "ProductBatch_branchId_expiryDate_idx" ON "ProductBatch"("branchId", "expiryDate");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "batchId" TEXT,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitCost" DECIMAL,
    "userId" TEXT NOT NULL,
    "reference" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "StockMovement_productId_branchId_createdAt_idx" ON "StockMovement"("productId", "branchId", "createdAt");
--> statement-breakpoint
CREATE INDEX "StockMovement_branchId_type_createdAt_idx" ON "StockMovement"("branchId", "type", "createdAt");
--> statement-breakpoint
CREATE INDEX "StockMovement_referenceId_idx" ON "StockMovement"("referenceId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" DATETIME,
    CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Purchase_number_key" ON "Purchase"("number");
--> statement-breakpoint
CREATE INDEX "Purchase_branchId_createdAt_idx" ON "Purchase"("branchId", "createdAt");
--> statement-breakpoint
CREATE INDEX "Purchase_supplierId_idx" ON "Purchase"("supplierId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityOrdered" DECIMAL NOT NULL,
    "quantityReceived" DECIMAL NOT NULL DEFAULT 0,
    "unitCost" DECIMAL NOT NULL,
    "batchNo" TEXT,
    "expiryDate" DATETIME,
    CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");
--> statement-breakpoint
CREATE INDEX "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");
--> statement-breakpoint
CREATE INDEX "Customer_name_idx" ON "Customer"("name");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL NOT NULL DEFAULT 0,
    "minQty" DECIMAL NOT NULL DEFAULT 1,
    "buyQty" INTEGER NOT NULL DEFAULT 1,
    "getQty" INTEGER NOT NULL DEFAULT 1,
    "productId" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Promotion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "Promotion_isActive_startsAt_endsAt_idx" ON "Promotion"("isActive", "startsAt", "endsAt");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "CashierSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingCash" DECIMAL NOT NULL,
    "expectedCash" DECIMAL,
    "actualCash" DECIMAL,
    "difference" DECIMAL,
    "notes" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "CashierSession_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "Register" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashierSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashierSession_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "CashierSession_branchId_openedAt_idx" ON "CashierSession"("branchId", "openedAt");
--> statement-breakpoint
CREATE INDEX "CashierSession_cashierId_status_idx" ON "CashierSession"("cashierId", "status");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "subtotal" DECIMAL NOT NULL,
    "discountTotal" DECIMAL NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL NOT NULL DEFAULT 0,
    "total" DECIMAL NOT NULL,
    "changeGiven" DECIMAL NOT NULL DEFAULT 0,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "soldAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sale_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sale_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashierSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Sale_clientId_key" ON "Sale"("clientId");
--> statement-breakpoint
CREATE UNIQUE INDEX "Sale_receiptNo_key" ON "Sale"("receiptNo");
--> statement-breakpoint
CREATE INDEX "Sale_branchId_soldAt_idx" ON "Sale"("branchId", "soldAt");
--> statement-breakpoint
CREATE INDEX "Sale_sessionId_idx" ON "Sale"("sessionId");
--> statement-breakpoint
CREATE INDEX "Sale_cashierId_soldAt_idx" ON "Sale"("cashierId", "soldAt");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "returnedQty" DECIMAL NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL NOT NULL,
    "unitCost" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "taxRate" DECIMAL NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL NOT NULL,
    CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");
--> statement-breakpoint
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "reference" TEXT,
    CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "Payment_saleId_idx" ON "Payment"("saleId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Return" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "approvedById" TEXT,
    "method" TEXT NOT NULL,
    "refundAmount" DECIMAL NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Return_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Return_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Return_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashierSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Return_number_key" ON "Return"("number");
--> statement-breakpoint
CREATE INDEX "Return_saleId_idx" ON "Return"("saleId");
--> statement-breakpoint
CREATE INDEX "Return_branchId_createdAt_idx" ON "Return"("branchId", "createdAt");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "amount" DECIMAL NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "Return" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "ReturnItem_returnId_idx" ON "ReturnItem"("returnId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "HeldSale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX "HeldSale_branchId_userId_idx" ON "HeldSale"("branchId", "userId");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "description" TEXT,
    "incurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX "Expense_branchId_incurredAt_idx" ON "Expense"("branchId", "incurredAt");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
--> statement-breakpoint
-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "branchId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
--> statement-breakpoint
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
--> statement-breakpoint
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
--> statement-breakpoint
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
--> statement-breakpoint
-- CreateTable
CREATE TABLE "Counter" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
-- AuditLog is append-only
CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER "AuditLog_no_delete" BEFORE DELETE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;

--> statement-breakpoint
-- One open session per register and per cashier
CREATE UNIQUE INDEX "CashierSession_open_register_key" ON "CashierSession"("registerId") WHERE "status" = 'OPEN';
--> statement-breakpoint
CREATE UNIQUE INDEX "CashierSession_open_cashier_key" ON "CashierSession"("cashierId") WHERE "status" = 'OPEN';
