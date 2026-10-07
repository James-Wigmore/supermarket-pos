# Legacy cloud setup (reference only)

Kept until the desktop version is confirmed in production. Nothing here is used by the desktop app or its build.

* `cloud/` Render blueprint, Railway config, Dockerfile and Vercel config of the old hosted version.
* `postgres/` the original PostgreSQL Prisma schema and migrations. The data model was converted to SQLite in `backend/prisma/`.

To move existing data from the old PostgreSQL database, export each table to CSV and import it into the matching table of the new
SQLite database (same table and column names, apart from the new `Counter`, `SyncState` and `SyncLog` tables).
Delete this folder when you no longer need it.
