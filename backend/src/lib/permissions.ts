import { Role } from '@prisma/client';

export const P = {
  DASHBOARD_READ: 'dashboard:read',
  PRODUCT_READ: 'product:read',
  PRODUCT_WRITE: 'product:write',
  PRODUCT_DELETE: 'product:delete',
  PRICE_WRITE: 'price:write',
  PRICE_OVERRIDE: 'price:override',
  PROMOTION_MANAGE: 'promotion:manage',
  STOCK_READ: 'stock:read',
  STOCK_ADJUST: 'stock:adjust',
  STOCK_RECEIVE: 'stock:receive',
  STOCK_TRANSFER: 'stock:transfer',
  SUPPLIER_READ: 'supplier:read',
  SUPPLIER_WRITE: 'supplier:write',
  PURCHASE_READ: 'purchase:read',
  PURCHASE_WRITE: 'purchase:write',
  SALE_CREATE: 'sale:create',
  SALE_READ: 'sale:read',
  SALE_READ_ALL: 'sale:read-all',
  SALE_VOID: 'sale:void',
  DISCOUNT_APPLY: 'discount:apply',
  REFUND: 'refund:create',
  SESSION_OWN: 'session:own',
  SESSION_READ_ALL: 'session:read-all',
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_WRITE: 'customer:write',
  EXPENSE_READ: 'expense:read',
  EXPENSE_WRITE: 'expense:write',
  REPORT_READ: 'report:read',
  AUDIT_READ: 'audit:read',
  USER_MANAGE: 'user:manage',
  BRANCH_MANAGE: 'branch:manage',
  SETTINGS_MANAGE: 'settings:manage',
} as const;

export type Permission = (typeof P)[keyof typeof P];

const ALL: Permission[] = Object.values(P);
const READ_ONLY = ALL.filter((p) => p.endsWith(':read') || p.endsWith(':read-all'));
const MANAGER = ALL.filter((p) => p !== P.BRANCH_MANAGE && p !== P.SETTINGS_MANAGE);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  MANAGER,
  CASHIER: [
    P.PRODUCT_READ, P.STOCK_READ, P.SALE_CREATE, P.SALE_READ, P.DISCOUNT_APPLY, P.SESSION_OWN,
    P.CUSTOMER_READ, P.CUSTOMER_WRITE,
  ],
  STOCK_OFFICER: [
    P.PRODUCT_READ, P.PRODUCT_WRITE, P.STOCK_READ, P.STOCK_RECEIVE, P.SUPPLIER_READ,
    P.PURCHASE_READ, P.PURCHASE_WRITE,
  ],
  ACCOUNTANT: [
    P.DASHBOARD_READ, P.PRODUCT_READ, P.STOCK_READ, P.SUPPLIER_READ, P.SUPPLIER_WRITE,
    P.PURCHASE_READ, P.SALE_READ, P.SALE_READ_ALL, P.SESSION_READ_ALL, P.CUSTOMER_READ,
    P.EXPENSE_READ, P.EXPENSE_WRITE, P.REPORT_READ,
  ],
  AUDITOR: READ_ONLY,
};

export const can = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);

/** Roles a user may assign, by their own role. */
/** Management hierarchy: a user can only be managed (password, email) by someone ranked above them. */
const ROLE_RANK: Record<Role, number> = { SUPER_ADMIN: 3, MANAGER: 2, CASHIER: 1, STOCK_OFFICER: 1, ACCOUNTANT: 1, AUDITOR: 1 };
export const outranks = (manager: Role, target: Role) => ROLE_RANK[manager] > ROLE_RANK[target];

export const ASSIGNABLE_ROLES: Record<Role, readonly Role[]> = {
  SUPER_ADMIN: Object.values(Role),
  MANAGER: [Role.CASHIER, Role.STOCK_OFFICER],
  CASHIER: [],
  STOCK_OFFICER: [],
  ACCOUNTANT: [],
  AUDITOR: [],
};
