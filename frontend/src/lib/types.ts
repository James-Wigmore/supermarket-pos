export type Role = 'SUPER_ADMIN' | 'MANAGER' | 'CASHIER' | 'STOCK_OFFICER' | 'ACCOUNTANT' | 'AUDITOR';
export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'OTHER';
export type Num = number | string;

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SessionUser {
  user: { id: string; name: string; email: string; role: Role; branchId: string | null };
  branch: { id: string; name: string; code: string } | null;
  permissions: string[];
}

export interface Barcode { id: string; code: string; isPrimary: boolean; isInternal: boolean }

export interface Promotion {
  id: string; name: string; type: 'PERCENT' | 'FIXED' | 'PROMO_PRICE' | 'BULK' | 'BOGO';
  value: Num; minQty: Num; buyQty: number; getQty: number; productId: string | null;
  startsAt: string; endsAt: string | null; isActive: boolean; product?: { name: string } | null;
}

export interface Product {
  id: string; sku: string; name: string; brand: string | null; manufacturer: string | null; unit: string; packageSize: string | null;
  imageUrl: string | null; purchasePrice: Num; taxRate: Num; minStock: Num; maxStock: Num | null; tracksExpiry: boolean; isActive: boolean;
  categoryId: string | null; supplierId: string | null;
  barcodes: Barcode[]; category: { id: string; name: string } | null; supplier: { id: string; name: string } | null;
  price: Num | null; stock: Num;
}

export interface LookupProduct extends Product { promotions: Promotion[]; supplierPrice: Num | null }

export interface Suggestion {
  barcode: string; name: string; brand?: string; manufacturer?: string; packageSize?: string; imageUrl?: string; category?: string; source: string;
}

export type LookupResult =
  | { source: 'internal'; product: LookupProduct }
  | { source: 'external'; suggestion: Suggestion }
  | { source: 'none'; lookupFailed?: boolean };

export interface Named { id: string; name: string }
export interface Branch extends Named { code: string; address: string | null; phone: string | null; isActive: boolean }
export interface Register extends Named { branchId: string; isActive: boolean }
export interface Supplier extends Named { contact: string | null; phone: string | null; email: string | null; address: string | null; balance: Num; isActive: boolean }
export interface Customer extends Named { phone: string | null; email: string | null; loyaltyPoints: number }

export interface Session {
  id: string; registerId: string; branchId: string; cashierId: string; status: 'OPEN' | 'CLOSED'; openingCash: Num;
  expectedCash: Num | null; actualCash: Num | null; difference: Num | null; openedAt: string; closedAt: string | null;
  register?: { name: string }; cashierName?: string | null;
}

export interface SaleLine { id: string; productId: string; name: string; quantity: Num; returnedQty: Num; unitPrice: Num; discount: Num; lineTotal: Num }
export interface Sale {
  id: string; receiptNo: string; status: 'COMPLETED' | 'VOIDED'; subtotal: Num; discountTotal: Num; taxTotal: Num; total: Num; changeGiven: Num;
  soldAt: string; offline: boolean; cashierName?: string | null; items: SaleLine[]; payments: { method: PaymentMethod; amount: Num }[];
  returns?: { id: string; number: string; refundAmount: Num }[];
}

export interface Receipt {
  sale: Sale;
  store: { storeName: string; header: string; footer: string; branch?: string; address?: string | null; phone?: string | null };
}

export interface Settings {
  currency: string;
  allowNegativeStock: boolean;
  discountLimitPercent: Record<Role, number>;
  loyalty: { enabled: boolean; unitAmount: number };
  receipt: { storeName: string; header: string; footer: string };
  expiryAlertDays: number;
}

export interface Approval { email: string; password: string }

/** Google Sheets synchronisation, as reported by the local backend. */
export interface CloudStatus {
  configured: boolean;
  connected: boolean;
  online: boolean;
  running: boolean;
  spreadsheetUrl: string | null;
  spreadsheetTitle: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  pending: number;
  failed: number;
  conflicts: number;
}
