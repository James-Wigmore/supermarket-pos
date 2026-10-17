# Supermarket POS, Inventory & Management System

Production-oriented point of sale for supermarkets: fast barcode checkout, stock control with full movement history,
receiving mode, pricing with history and scheduling, multi-branch, shifts, returns, reports, audit log and an offline-tolerant till.

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, Recharts, IndexedDB (`idb`) |
| Backend | Node 22, Express 5, TypeScript, Zod 4, JWT (HS256), bcrypt, Pino, Helmet, rate limiting |
| Data | SQLite (single local file), Prisma 7 (`@prisma/adapter-better-sqlite3`) |
| Desktop | Electron (main process runs the backend in-process, no network server), preload bridge with context isolation |
| Documents | PDFKit (receipts, labels, reports), ExcelJS (xlsx), CSV, bwip-js (Code 128 / EAN-13) |
| Tests | Vitest + Supertest (backend, temporary SQLite file), Vitest (frontend) |

```
backend/    Express API  (src/{config,lib,middleware,routes,services,validators,types}, prisma/, tests/)
frontend/   React app    (src/{components,pages,lib})
desktop/    Electron shell (main/, ipc/, preload/, packaging/stage.mjs)
legacy/     Previous cloud setup (Render/Railway/Vercel configs, PostgreSQL schema + migrations), kept for reference
```

## 1. Run it locally

Requirements: Node 22+. No database server is needed: the data lives in one SQLite file.

```bash
# 1. Backend
cd backend
cp .env.example .env                         # edit JWT_SECRET; DATABASE_URL defaults to file:./pos.db
npm install                                  # also generates the Prisma client
npm run db:migrate                           # creates/updates backend/pos.db (also runs automatically on start)
npm run db:seed                              # development data (refuses to run in production)
npm run dev                                  # http://localhost:4000/api/health

# 2. Frontend (new terminal)
cd frontend
npm ci
npm run dev                                  # http://localhost:5173 (proxies /api to :4000)
```

### Development credentials (never use in production)

All seeded accounts use the password **`Password123!`**

| Role | Email |
| --- | --- |
| SUPER_ADMIN | admin@supermarket.test |
| MANAGER | manager@supermarket.test |
| CASHIER | cashier@supermarket.test |
| STOCK_OFFICER | stock@supermarket.test |
| ACCOUNTANT | accountant@supermarket.test |
| AUDITOR | auditor@supermarket.test |

The seed creates one branch (`MAIN`) with two registers, 7 categories, 2 suppliers and 12 products with opening stock
(barcodes `6001000000011` … `6001000000103` can be typed into the POS scan box).

## 2. Windows desktop app

The desktop app runs the same React UI and the same backend code inside Electron. The UI talks to the backend through
an in-process bridge (no port is opened), the database is a SQLite file in the user's profile, and nothing needs a cloud
server for normal selling.

```bash
# once (Windows, macOS or Linux; Node 22+)
npm run install:all           # backend (generates the Prisma client), frontend and desktop dependencies

# build everything and start the desktop app
npm run desktop:dev           # builds backend + frontend + desktop, stages desktop/stage, launches Electron
npm run desktop:build         # same, without launching
```

Electron needs its own build of the SQLite driver, so the app is assembled in `desktop/stage` (its own `node_modules`,
rebuilt for Electron). Your normal `backend/node_modules` stay untouched and `npm test` keeps working.
For UI work with hot reload: run `npm run dev:frontend`, then start Electron with `POS_DEV_URL=http://localhost:5173`
(PowerShell: `$env:POS_DEV_URL='http://localhost:5173'; .\\desktop\\node_modules\\.bin\\electron desktop\\stage`).

**Where data lives (Windows):** `%APPDATA%\supermarket-pos\data\pos.db` (database) and `%APPDATA%\supermarket-pos\config.json`
(printer, backup settings and the per-installation login secret). Nothing is stored in the install folder, so updates and
re-installs keep your data.

**First run:** the app shows a setup wizard (business, currency, branch, registers, administrator) until the first
administrator exists. After that the normal sign-in screen is used and cashiers never see the wizard.

**Printing:** receipts print through Windows. In *Settings > Printer and backups* choose a printer and, optionally, silent
printing (no dialog). Set the paper size (e.g. 80 mm) in the printer's Windows settings.

**Backup and restore** (administrators, *Settings > Printer and backups*): *Back up now* writes a consistent copy of the
database to `Documents\Supermarket POS Backups` (or the folder you choose); an automatic daily backup keeps the last 14.
*Restore* asks you to pick a backup file, saves a safety copy of the current data first, then restarts the app. The swap happens during that restart, while nothing has the database open, and the replaced database is kept as `pos.db.replaced` beside it.

**Excel/CSV/PDF exports:** *Reports* now includes *Products* and *Purchases* besides sales, stock, movements and expenses; every report
exports to Excel with the selected date range, generated locally.

### Building the Windows installer

Build on **Windows 10/11** (or let GitHub Actions do it, see below). Requirements: Node 22+, and, only if a prebuilt SQLite driver
is not available for your Electron version, the "Desktop development with C++" tools of Visual Studio Build Tools.

```powershell
npm run install:all        # once
npm run check              # typecheck, lint, tests, frontend build (recommended before releasing)
npm run desktop:package    # builds everything and creates the installer
```

The installer is created at **`desktop\release\Supermarket-POS-Setup.exe`**. Copy that single file to the shop PCs.
`npm run desktop:build` stops after assembling the app (`desktop\stage`) without making the installer.

Without a Windows PC: *GitHub > Actions > "Windows installer" > Run workflow* builds it on a Windows runner and attaches
`Supermarket-POS-Setup.exe` as a downloadable artifact (this also runs when you push a tag such as `v1.0.0`).
Commit the three `package-lock.json` files first (backend, frontend, desktop): the workflow uses `npm ci`.

**What the installer does:** installs for the current Windows user (no administrator rights needed; you can choose the folder),
adds a Start Menu shortcut and a Desktop shortcut, and registers an uninstaller. Your data is **never** inside the program folder:
it lives in `%APPDATA%\supermarket-pos` (database, settings, Google sign-in), so installing a newer version over the old one, re-installing,
or uninstalling keeps all sales and stock. To remove everything, delete that folder yourself after uninstalling (back up first).
To skip the Desktop shortcut, set `createDesktopShortcut: false` in `desktop/packaging/electron-builder.config.cjs`.

**Windows SmartScreen:** an unsigned installer shows "Windows protected your PC": click *More info > Run anyway*. To remove the
warning, buy a code-signing certificate and set `CSC_LINK` (path or URL of the .pfx) and `CSC_KEY_PASSWORD` before packaging
(or as GitHub secrets of the same name).

**Installing an update:** build the new installer and run it on the shop PC. Close the POS first. The database is migrated
automatically the first time the new version starts, after which older backups can still be restored.

**Adding automatic updates later:** the installer already has a stable name, app ID and per-user layout. To add updates, install
`electron-updater`, set `publish` in `electron-builder.config.cjs` (for example to GitHub Releases) and call
`autoUpdater.checkForUpdatesAndNotify()` in `desktop/main/main.ts` once the window is ready. Nothing else has to change.

### Acceptance checklist (run on a clean Windows PC with no internet first)
1. Install, then start from the Start Menu. The setup wizard appears. Create the store and administrator.
2. Sign in, add a product with a barcode, add stock (*Receiving*), open a shift.
3. Scan the barcode with the USB scanner (it types like a keyboard): the product is added. Sell, pay, print the receipt.
4. Check *Reports* (daily sales, stock) and export one to Excel.
5. Close and reopen the app: everything is still there. Unplug the network: selling still works.
6. *Settings > Printer and backups*: *Back up now*, then *Restore* that backup.
7. *Settings > Google Sheets*: connect (needs internet), watch the pending count fall to 0 and the sale appear in the sheet.
   Edit a price in the sheet and press *Sync now*: the new price appears in the POS.
8. Install the same installer again over the top: all data is still there.

### Troubleshooting
| Problem | What to do |
| --- | --- |
| `Cannot create symbolic link` while packaging | Windows blocks a tool used by electron-builder. Turn on *Developer Mode* (Settings > For developers) or run the terminal as administrator, then retry. |
| `better-sqlite3` fails to build or load | Install Visual Studio Build Tools (C++ workload), delete `desktop\stage\node_modules`, run `npm run desktop:build` again. |
| "Prisma client not generated" | Run `npm install` in `backend`, then retry. |
| App shows "could not start" | The message says why. The log folder is `%APPDATA%\supermarket-pos`; if the database file is damaged, restore a backup from `Documents\Supermarket POS Backups`. |
| Receipt prints on the wrong printer | *Settings > Printer and backups > Receipt printer*, pick the printer (and untick silent printing to see the Windows print window). |
| Google says "access blocked" | Add the Google account as a *Test user* on the OAuth consent screen, or publish the app (see the Google section). |
| Sync pill shows failed records | Hover for details and see *Settings > Google Sheets > Recent activity*. Failed records retry automatically. |
| Antivirus quarantines the installer | Unsigned installers are sometimes flagged; sign it (see above) or add an exception. |

## 3. Google Sheets synchronisation

The POS never needs Google to sell. A copy of your data is sent to a Google spreadsheet you own, and the owner can edit
selected columns there (prices, product names, suppliers...) which the POS picks up. It is set up inside the Windows app by an
administrator: *Settings > Google Sheets*. Nothing secret is stored in the source code or the installer.

### One-time Google Cloud setup (about 10 minutes)
1. Open <https://console.cloud.google.com/> and create a project (e.g. "Supermarket POS").
2. *APIs & Services > Library*: search for **Google Sheets API** and click **Enable**.
3. *APIs & Services > OAuth consent screen*: choose **External**, fill in the app name and your email, and add your own Google
   account (and the owner's) under **Test users**. (Publishing the app is not needed; test users can use it indefinitely
   for personal use, but Google asks them to sign in again about every 7 days while the app is in "Testing". Click
   *Publish app* to avoid that: no review is needed for personal use.)
4. *APIs & Services > Credentials > Create credentials > OAuth client ID*, application type **Desktop app**. Download the JSON file.
5. In the POS: *Settings > Google Sheets*, then **1. Choose credentials file**, **2. Connect Google account** (a browser
   opens; approve access to Google Sheets), **3. Create spreadsheet** (or paste the link of an empty one).

The credentials file and the sign-in token are stored encrypted with Windows' own protection (`%APPDATA%\supermarket-pos\google.bin`)
and never reach the web page. Do not commit the JSON file; `.gitignore` already excludes `client_secret*.json`.

### What is synchronised
Tabs created automatically: `ADMINISTRATION` (the owner's guide), `Products`, `Categories`, `Stock`, `Stock_Movements`, `Sales`,
`Sale_Items`, `Payments`, `Purchases`, `Purchase_Items`, `Suppliers`, `Customers`, `Returns`, `Return_Items`, `Promotions`, `Users`
(never passwords), `Branches`, `Registers`, `Shifts`, `Expenses`, `Settings`, `Audit_Log` and `Sync_Log`. Every row starts with the
record's stable ID (a UUID); that ID is also the remote ID.

| Direction | Data |
| --- | --- |
| POS to sheet only | Sales, payments, stock, movements, purchases, returns, shifts, expenses, users, audit... Google warns before editing these columns |
| Both ways (editable columns) | `Products` (name, brand, category, unit, prices, tax, min/max stock, active), `Categories` (name), `Suppliers` (contact details, active), `Promotions` (name, value, dates, active) |
| Owner adds rows | Products, categories and suppliers: add a row with an empty `id`; the POS creates the record and fills in the id |

### How it works
* Database triggers put every changed record in a queue (`SyncState`: PENDING, SYNCING, SYNCED, FAILED, CONFLICT with attempts,
  last attempt, last success, error). Selling never waits for it.
* A background job runs about every minute while records are waiting (and every 10 minutes to look for sheet edits). It sends
  changes in batches, addressing rows by ID, so a retry updates the same row and **never duplicates** a sale.
* Offline: records simply stay pending. Google rejecting a batch marks those records FAILED (visible in the status pill) and they
  are retried automatically with a growing pause.
* Conflicts: if the same product/supplier/etc. was changed in both places, nothing is overwritten. It appears under
  *Settings > Google Sheets > Changes to review* and in `Sync_Log`; the administrator keeps the POS or the sheet version.
* Safety: an empty or wiped sheet never deletes anything in the POS. A backup is made before the first synchronisation with a
  spreadsheet and before a large number of sheet changes are applied. *Re-send all data* rebuilds an emptied sheet.
* Status pill (top bar): Online/Offline, last synchronised time, pending and failed counts (hover for details).

### Limits
Google allows 10 million cells per spreadsheet and about 60 writes per minute per user. Sales and stock-movement tabs grow with every
sale: a busy supermarket may need a new spreadsheet after a few years. Edits to products made in the sheet are applied within about 10
minutes (or *Sync now*).

## 4. Verify everything

```bash
cd backend  && npm run typecheck && npm run lint && npm test && npm run build
cd frontend && npm run lint && npm test && npm run build
# or from the repository root after install:all:   npm run check
```

Backend tests create a temporary SQLite file for each run and delete it afterwards; your `pos.db` is never touched.

## 5. Deploy

The cloud deployment (Render + Vercel + PostgreSQL) is being replaced by a Windows desktop app. The old configuration is kept in `legacy/` for reference and no longer matches the backend.

## 6. How the main flows work

**Checkout (POS).** Scan → product → cart → total → payment → change → receipt. The scan box is always focused; `2*<barcode>` sets a quantity;
`F2` focus scan, `F4` pay, `F8` hold, `F9` resume, `+ / − / Delete` edit the selected line. The server re-prices every cart (effective price, promotions, tax) and
**never trusts client prices or totals**. Sale, payments, stock deduction (FEFO for expiry-tracked products) and audit entries happen in one database transaction;
stock is untouched when anything fails. Cash change is derived from cash tendered only.

**Approvals.** A cashier needing a price override, a discount above their limit, a void or a refund types a manager's credentials in a dialog.
The backend verifies the manager (same branch, sufficient role, lockout after 5 failures) and records a `MANAGER_APPROVAL` audit entry.
Discount limits per role are editable in Settings.

**Barcodes.** Internal catalogue first → (staff only) configurable external service for identification data → pre-filled form that staff must confirm →
saved locally and cached for 90 days. If the service is down, manual creation still works. Products with no manufacturer barcode get a generated in-store EAN-13
(prefix `20`, check digit) that scans exactly like any other; labels print from Products → *Print labels* (A4 sheet, Code 128). Products can have many barcode aliases.

**Receiving mode.** Choose supplier → scan → quantity (+ cost / batch / expiry when needed) → next scan. The card shows last supplier price, stock and selling price.
The whole delivery is reviewed and then booked in one transaction (`PURCHASE` movements, supplier price memory, supplier balance). Purchase orders do not touch stock until goods are received.

**Inventory.** `StockMovement` is the ledger (opening, purchase, sale, return, damaged, expired, loss, adjustment, transfers); `StockLevel` is a cached quantity updated in the
same transaction with a guarded decrement, so negative stock is impossible unless enabled in Settings.

**Pricing.** `PriceHistory` is append-only. A future `effectiveFrom` schedules a price; the till always uses the row in force at the time of sale. Promotions: percent, fixed, promo price, bulk, buy-X-get-Y.

**Offline till.** The POS shows `ONLINE / OFFLINE / SYNCING` (plus queued/failed counts). If the API is unreachable at payment, the sale is stored in IndexedDB with its
`clientId` and uploaded in order when connectivity returns; the server de-duplicates on `clientId`, so retries never double-sell. Products scanned earlier are cached for offline lookup.
Rejected sales are kept and shown on the Sales page, never silently dropped.

**Security.** bcrypt hashes, short-lived JWTs invalidated by password change/deactivation (`tokenVersion`), backend permission checks on every route, Zod validation,
Prisma parameterised queries, Helmet, strict CORS allow-list, rate limits (global, login, approval emails and links), redacted logs, immutable audit log (database triggers reject UPDATE/DELETE/TRUNCATE),
cost prices hidden from cashiers, spreadsheet-formula-safe exports. Branch isolation is enforced server-side for every branch-scoped resource.

## 6a. Sign-in security: email login approval and password resets

**Email login approval.** After a correct password the till shows a waiting screen and the server emails the user's registered address with two links,
**Approve Login** and **Reject Login**. The sign-in only completes once the emailed link is approved, and only on the browser that asked for it.

* **Who must use it** is a setting (Settings → General → *Email login approval*, super admin only). The default is **Super admin and Manager**.
  Anyone else can turn it on for themselves under **Security** in the top bar (it needs their password and a test email that must be delivered).
* Each request lives **5 minutes**. Once approved, the waiting browser has a further **2 minutes** to collect its session. A request is dead after approval,
  rejection, expiry or cancellation: a link can be used once, a rejected or expired request can never be approved later, and a newer sign-in cancels the older one.
* The links open a page **hosted by the backend** (`PUBLIC_BASE_URL/api/auth/approve?token=…`) that shows who/when/where and asks for one more press. Opening a link
  changes nothing, so mail scanners cannot approve by accident. Approving needs no access to the till's PC, only the backend's public address.
* Tokens are 256-bit random values; only SHA-256 hashes are stored (approve, reject and the waiting browser's token are three different secrets). Neither tokens nor
  passwords reach the audit log. Every step is audited: `LOGIN_APPROVAL_REQUESTED`, `_APPROVED`, `_REJECTED`, `_EXPIRED`, `_CANCELLED`, `_EMAIL_FAILED`, `_INVALID_LINK`,
  and the final `LOGIN` records `method: email_approval`.
* Limits: 3 approval emails per account and 10 per address per window, 150 sign-in/status requests per address per 15 minutes, 60 status checks a minute per request,
  and 20 bad tokens per address per 15 minutes.
* If the email cannot be sent the user sees *"We couldn't send the approval email…"* (HTTP 503), no session is issued and the failure is audited without any secret.

**If email is not configured** the app still works, but it says so: everyone signs in with a password only, the banner *"Email sign-in approval is OFF"* shows on every
page, `/api/auth/me` returns `loginApproval.configured: false`, the first-run setup shows the same warning, and the audit log records `EMAIL_APPROVAL_OFF` at start-up
and `emailApproval: OFF` on every password sign-in. **The Windows desktop app has no public address, so email approval is off there by design.** Use it with the hosted backend.

### Setting up email

Set these in `backend/.env` (or the host's environment settings, e.g. Render) and restart. Leave `SMTP_HOST`, `EMAIL_FROM` and `PUBLIC_BASE_URL` all empty to run without email approval.
A half-filled configuration stops the server at start with a clear message.

| Variable | Meaning |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Your mail server. `SMTP_SECURE=true` for port 465, `false` for 587 (STARTTLS) |
| `SMTP_USER`, `SMTP_PASS` | Login for that server (both or neither). Never exposed to the browser or logs |
| `EMAIL_FROM` | Sender, e.g. `pos@yourshop.com` or `Shop POS <pos@yourshop.com>` |
| `PUBLIC_BASE_URL` | The public address of **this backend**, e.g. `https://pos-api.onrender.com` (https is required in production) |

Any SMTP provider works. Examples: **Gmail / Google Workspace** `smtp.gmail.com:587` with an *app password*; **Microsoft 365** `smtp.office365.com:587`;
**Brevo** `smtp-relay.brevo.com:587`; **SendGrid** `smtp.sendgrid.net:587` (user `apikey`); **Mailgun** `smtp.mailgun.org:587`; **Amazon SES** the SMTP endpoint of your region.
At start-up the server checks the mail server and logs `Email login approval is ON` or the reason it is not.

**Who can change passwords and emails.** Rank decides, not the user:

| Action | Who |
| --- | --- |
| Reset the password of cashiers, stock officers, accountants, auditors | **Manager** (own branch) or Super admin |
| Reset the password of a manager | Super admin |
| **Correct a user's email** (also their sign-in name; fixes a mistyped or lost address) | The same people, never for yourself |
| Change **your own** password | Managers and Super admins only |
| Turn optional email approval on or off for yourself | Anyone, with their password (not off where the role requires it) |

A reset or an email change signs that user out of every device and cancels their pending approvals.

**Locked-out owner (wrong email, lost mailbox, broken mail server).** A manager cannot change a super admin, by design. On the PC that holds the database run:

```bash
cd backend
RECOVER_EMAIL=owner@shop.com RECOVER_NEW_EMAIL=right@shop.com RECOVER_PASSWORD='a new passphrase' npm run auth:recover   # the last two are optional
RECOVER_EMAIL=cashier@shop.com RECOVER_EMAIL_APPROVAL=off npm run auth:recover                                         # switch off optional approval
```

It signs the user out everywhere, cancels pending approvals and records `ACCOUNT_RECOVERY`. It needs file access to the database, so it cannot be used through the app.
If the mail server itself is down for long, blank `SMTP_HOST` and restart: sign-in falls back to password only, loudly (see above), until you restore it.

**Upgrading from authenticator-app two-factor.** The migration removes the secret and recovery-code columns. Anyone who had it on is switched to *opted in* to email approval,
and the old "required roles" setting is kept under its new name, so nobody ends up with less protection than before once email is configured.
**Until email is configured, nobody has a second step**, and the app says so.

## 7. Known limitations (read before go-live)

* **The Windows installer and Electron app were assembled without being run in the development environment.** Do the acceptance checklist above on a real PC before trusting it with a live shop.
* In the desktop app every sale is saved locally first, so the browser-style offline queue is not used there. (It remains for running the web version in a browser.)
* Database changes: edit `backend/prisma/schema.prisma`, then add a folder under `backend/prisma/migrations/` with a `migration.sql` (statements separated by a line
  `--> statement-breakpoint`). Migrations run automatically when the app starts. Keep triggers of the Google Sheets queue (`20261005…_google_sheets_sync`) in step with new synchronised tables.
* Quantities and amounts are stored as SQLite decimals (floating point): whole quantities and 2-decimal prices are exact, fractional weights can show tiny rounding noise.
* Receipts print through Windows (or as an 80 mm PDF). ESC/POS thermal-printer commands (cash-drawer kick, paper cut) are not included.
* There is no bulk CSV import. Data comes in through the app, by restoring a backup, or by editing the allowed columns in Google Sheets.
* Failed sign-ins are limited per account (10 per 15 minutes), and all sign-in requests per address (150 per 15 minutes), because every request on the shop PC comes from the same address.
* Email approval is hosted-only: it needs the backend reachable at `PUBLIC_BASE_URL`. A local-network mode is not built.
* Backups are copies of the database (they contain password hashes and sales). Keep the backup folder private.
* Mobile-money payments are recorded (with a reference) but not integrated with a provider API.
* One shop PC holds the database; running the same store on several PCs at once is not supported (each PC would have its own database).
* The `legacy/` folder keeps the previous cloud setup (Render/Railway/Vercel, PostgreSQL schema and migrations) for reference. Delete it once the desktop version has run in your shop.
