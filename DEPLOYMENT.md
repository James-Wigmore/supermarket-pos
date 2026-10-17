# Production and Release Guide

## Supported release

The supported production package is the Windows desktop installer. The app runs its API in-process and stores its SQLite database and configuration in the current Windows user's profile. Google Sheets is an optional sync target; it is not the live database.

1. Ensure `desktop/package.json` has the intended release version.
2. Push a matching tag such as `v1.0.0`.
3. GitHub Actions runs `npm run check`, builds the installer on Windows, and publishes `Supermarket-POS-Setup.exe` to the GitHub Release. A manually dispatched installer workflow creates an Actions artifact but does not publish a release.
4. Install on a clean Windows 10/11 machine and run the acceptance checklist in the README before store rollout.

The installer is unsigned unless the GitHub Actions secrets `CSC_LINK` and `CSC_KEY_PASSWORD` are configured. Unsigned installers show a Windows SmartScreen warning. Signing certificates and secrets are not included in this repository.

## Hosted browser deployment

Vercel is a frontend host only. The current backend uses SQLite and requires durable filesystem storage, so do not deploy it to Vercel serverless functions or use ephemeral container storage. A hosted deployment must use one persistent Node backend instance with a durable volume, backups, monitoring, and TLS. SQLite is not configured for horizontal scaling or concurrent backend replicas. The old PostgreSQL hosting configurations in `legacy/` do not match this backend.

### Render backend setup

The root `render.yaml` is a starting blueprint for the hosted email-approval version. Create a Render Blueprint from this repository and choose the `starter` web-service plan; the free plan does not provide the persistent disk this SQLite database requires. The service is deliberately configured as one instance with a 1 GB disk mounted at `/var/data`, and stores the database at `file:/var/data/pos.db`.

The blueprint generates `JWT_SECRET`. After Render creates the service and shows its public URL, set these environment values in the Render dashboard and redeploy:

- `PUBLIC_BASE_URL`: backend origin only, such as `https://supermarket-pos-email-api.onrender.com` (no `/api` suffix).
- `CORS_ORIGINS`: the exact Vercel production origin, such as `https://your-pos.vercel.app`.
- `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASS`: values from your email provider. Put credentials only in Render's environment settings.

The backend sends approval links to `PUBLIC_BASE_URL/api/auth/approve` and `/reject`; this must be the reachable backend URL, not the Vercel URL. Do not enable approval requirements until a real test email has been delivered and both approval and rejection have been tested.

To configure Vercel:

- Set the project root to `frontend`, framework to Vite, and output directory to `dist`.
- Set `VITE_API_URL` to the public backend origin followed by `/api` (for example `https://supermarket-pos-email-api.onrender.com/api`) in the Vercel Production environment.
- Add GitHub Actions secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`; configure the GitHub `production` environment.
- The `Vercel Production Deploy` workflow runs only after the `CI` workflow succeeds on `main` and deploys that exact tested commit.

Configure the backend using `backend/.env.example` and the schema in `backend/src/config/env.ts`. At minimum, production needs a strong unique `JWT_SECRET`, `NODE_ENV=production`, a durable `DATABASE_URL`, the frontend origin in `CORS_ORIGINS`, and a correct `TIMEZONE`. Keep database backups outside the application container and test restores.

For email login approval, set `PUBLIC_BASE_URL` to the publicly reachable backend origin (not the Vercel frontend URL), and configure `EMAIL_FROM`, `SMTP_HOST`, and SMTP credentials. The backend validates partial email configuration at startup. Verify actual delivery and approve/reject links before enabling approval requirements for users.

**Email approval is not available in the packaged desktop mode:** the desktop API runs in-process and opens no HTTP listener, so emailed links cannot reach that installation. Do not treat desktop email approval as a production security control. Use the hosted browser deployment with a public persistent API when email approval is required, or keep the desktop installation on password-based sign-in.

## Go-live checks

- GitHub CI is green for the exact release commit; tagged versions match `desktop/package.json`.
- Run the Windows installer acceptance checklist, including restart persistence, receipt printing, backup and restore, and offline checkout.
- Set real SMTP credentials and verify email approval on the hosted API if that deployment mode is selected.
- Connect Google Sheets from an administrator account only after configuring the intended owner account; verify pending and failed sync counters and perform a restore-capable backup first.
- Rotate any demo credentials, confirm no secrets or credential files are committed, configure installer signing if required, and record an owner for backups, updates, and incident response.

No production credentials, cloud resources, signing certificates, or Google OAuth credentials are stored in this repository. A green build is not a substitute for configuring and testing those live services.
