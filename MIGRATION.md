# Migration summary: cloud web app to Windows desktop POS

## Architecture
* **Electron shell** (`desktop/`): main process, sandboxed preload with context isolation, in-process bridge to the existing Express backend (no network server), fixed `app://` origin for the UI, CSP, single instance.
* **Local SQLite database** in `%APPDATA%\supermarket-pos\data\pos.db` (Prisma + better-sqlite3), SQL migrations applied at start (`backend/src/lib/migrate.ts`). Stable UUID ids throughout.
* **Google Sheets sync** (`backend/src/sync/`): trigger-fed queue (`SyncState`), batched idempotent push, validated pull of owner edits, conflict journal (`SyncLog`), OAuth installed-app flow with tokens encrypted by Windows (`desktop/main/google.ts`).
* **Backups** (`desktop/main/backup.ts`): consistent `VACUUM INTO` copies, daily automatic backup, safety copy before restore and before large syncs.
* **Installer**: electron-builder NSIS, per-user, data kept outside the program folder, built by `npm run desktop:package` or the `Windows installer` GitHub workflow.
* The React UI, roles/permissions, business rules, reports and workflows are the existing ones. New screens: first-run wizard, Settings > Google Sheets, Settings > Printer and backups.

## New dependencies
* backend: `@prisma/adapter-better-sqlite3` (replaces `@prisma/adapter-pg`, `pg`)
* frontend: `@fontsource-variable/public-sans` (font bundled for offline use)
* desktop: `electron`, `electron-builder`, `@electron/rebuild` (dev); `light-my-request` (runtime)

## Files created (56)
- `.github/workflows/desktop.yml`
- `MIGRATION.md`
- `backend/prisma/migrate.ts`
- `backend/prisma/migrations/20261004000000_sqlite_init/migration.sql`
- `backend/prisma/migrations/20261005000000_google_sheets_sync/migration.sql`
- `backend/src/lib/migrate.ts`
- `backend/src/lib/time.ts`
- `backend/src/routes/setup.routes.ts`
- `backend/src/routes/sync.routes.ts`
- `backend/src/services/setup.service.ts`
- `backend/src/sync/cells.ts`
- `backend/src/sync/engine.ts`
- `backend/src/sync/entities.ts`
- `backend/src/sync/guide.ts`
- `backend/src/sync/runtime.ts`
- `backend/src/sync/sheets.ts`
- `backend/src/sync/store.ts`
- `backend/src/validators/setup.ts`
- `backend/tests/db-path.ts`
- `backend/tests/fake-sheets.ts`
- `backend/tests/global-setup.ts`
- `backend/tests/setup.test.ts`
- `backend/tests/setup.ts`
- `backend/tests/sync.test.ts`
- `desktop/bridge.ts`
- `desktop/ipc/api.ts`
- `desktop/ipc/google.ts`
- `desktop/ipc/handle.ts`
- `desktop/ipc/system.ts`
- `desktop/main/backend.ts`
- `desktop/main/backup.ts`
- `desktop/main/config.ts`
- `desktop/main/google.ts`
- `desktop/main/main.ts`
- `desktop/main/paths.ts`
- `desktop/main/protocol.ts`
- `desktop/main/window.ts`
- `desktop/package.json`
- `desktop/packaging/electron-builder.config.cjs`
- `desktop/packaging/icon.png`
- `desktop/packaging/stage.mjs`
- `desktop/preload/preload.ts`
- `desktop/tsconfig.json`
- `frontend/src/lib/desktop.ts`
- `frontend/src/pages/DesktopSettings.tsx`
- `frontend/src/pages/Setup.tsx`
- `frontend/src/pages/SheetsSettings.tsx`
- `legacy/README.md`
- `legacy/cloud/.dockerignore`
- `legacy/cloud/Dockerfile`
- `legacy/cloud/railway.json`
- `legacy/cloud/render.yaml`
- `legacy/cloud/vercel.json`
- `legacy/postgres/migrations/20261003000000_init/migration.sql`
- `legacy/postgres/migrations/migration_lock.toml`
- `legacy/postgres/schema.prisma`

## Files modified (58)
- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `backend/.env.example`
- `backend/package.json`
- `backend/prisma.config.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/seed-admin.ts`
- `backend/prisma/seed.ts`
- `backend/src/config/env.ts`
- `backend/src/lib/crud.ts`
- `backend/src/lib/documents.ts`
- `backend/src/lib/prisma.ts`
- `backend/src/lib/sequence.ts`
- `backend/src/lib/settings.ts`
- `backend/src/lib/sql.ts`
- `backend/src/middleware/rateLimit.ts`
- `backend/src/routes/index.ts`
- `backend/src/routes/product.routes.ts`
- `backend/src/server.ts`
- `backend/src/services/approval.service.ts`
- `backend/src/services/dashboard.service.ts`
- `backend/src/services/inventory.service.ts`
- `backend/src/services/product.service.ts`
- `backend/src/services/report.service.ts`
- `backend/src/services/sale.service.ts`
- `backend/src/services/stock.service.ts`
- `backend/src/validators/auth.ts`
- `backend/tests/auth.test.ts`
- `backend/tests/helpers.ts`
- `backend/tsconfig.json`
- `backend/vitest.config.mts`
- `frontend/index.html`
- `frontend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/components/Receipt.tsx`
- `frontend/src/components/StatusPill.tsx`
- `frontend/src/index.css`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/auth.tsx`
- `frontend/src/lib/format.ts`
- `frontend/src/lib/queries.ts`
- `frontend/src/lib/sync.tsx`
- `frontend/src/lib/types.ts`
- `frontend/src/main.tsx`
- `frontend/src/pages/Expenses.tsx`
- `frontend/src/pages/Products.tsx`
- `frontend/src/pages/Promotions.tsx`
- `frontend/src/pages/Receiving.tsx`
- `frontend/src/pages/Reports.tsx`
- `frontend/src/pages/Sales.tsx`
- `frontend/src/pages/Settings.tsx`
- `frontend/src/pages/Shifts.tsx`
- `frontend/src/pages/Suppliers.tsx`
- `frontend/src/pages/pos/OpenShift.tsx`
- `frontend/src/pages/pos/Pos.tsx`
- `package.json`

## Files moved out of the production tree or removed (7)
Cloud deployment files and the PostgreSQL schema/migrations were moved into `legacy/` (kept for reference); the others were replaced by SQLite equivalents.
- `backend/.dockerignore`
- `backend/Dockerfile`
- `backend/prisma/migrations/20261003000000_init/migration.sql`
- `backend/prisma/migrations/migration_lock.toml`
- `backend/railway.json`
- `frontend/vercel.json`
- `render.yaml`
