# Production and Release Guide

## Supported release

The supported production package is the Windows desktop installer. The app runs its API in-process and stores its SQLite database and configuration in the current Windows user's profile. Google Sheets is an optional sync target; it is not the live database.

1. Ensure `desktop/package.json` has the intended release version.
2. Push a matching tag such as `v1.0.0`.
3. GitHub Actions runs `npm run check`, builds the installer on Windows, and publishes `Supermarket-POS-Setup.exe` to the GitHub Release. A manually dispatched installer workflow creates an Actions artifact but does not publish a release.
4. Install on a clean Windows 10/11 machine and run the acceptance checklist in the README before store rollout.

The installer is unsigned unless the GitHub Actions secrets `CSC_LINK` and `CSC_KEY_PASSWORD` are configured. Unsigned installers show a Windows SmartScreen warning. Signing certificates and secrets are not included in this repository.

## Automatic updates for the installed app

Installed apps look for new versions in **this repository's GitHub Releases**, so the repository must stay public. (A private repository
cannot be read by an installed app without a secret saved on every shop PC, so if the repository is ever made private, installed apps
simply stop finding updates.) No tokens or extra settings are needed: the release workflow already has permission to publish releases.

## Trying changes before users get them (test channel)

A test build has its own identity, so it never touches the shop's real data and never updates. It installs next to the real app as "Supermarket POS TEST" (data in `%APPDATA%\supermarket-pos-test`, backups in `Documents\Supermarket POS TEST Backups`).

- `npm run desktop:dev` runs from source as a test build (add `--live` to the script only if you really want the real data).
- `npm run desktop:test` builds `desktop/release/Supermarket-POS-TEST-Setup.exe`. A manual run of the "Windows installer" workflow builds the same test installer as a downloadable artifact; only a pushed `v*` tag builds the real one.
- To test against real shop data, close both apps and copy `%APPDATA%\supermarket-pos\data\pos.db` into `%APPDATA%\supermarket-pos-test\data\` (a copy, never the other way round).
- Routine: change, `npm run check`, `npm run desktop:test`, try it, then `npm run release -- patch`.

**Releasing:** from a clean `main`, run `npm run release -- patch` (or `minor`, `major`, or an exact version such as `1.2.0`; add `--dry` to only print the steps). It runs the checks, raises `version` in `desktop/package.json`, commits, pushes the matching tag (`v1.2.0`) and `main`. By hand, that is: raise the version, commit, push the tag. The workflow runs the checks, builds the
installer with this repository as its update source and publishes `Supermarket-POS-Setup.exe` and `latest.yml` to the release. Installed
apps then offer the update to administrators within about 6 hours (or at once via *Check for updates*). Manually started workflow runs only
create a downloadable artifact: nothing is published, so nothing is offered.

**First update-enabled install:** older installs contain no update code. Install the first release built by this workflow by hand on each PC.

**Withdrawing a bad release:** delete that release in GitHub so it is no longer offered, then publish a fixed, higher version. Apps never
downgrade, and a machine that already installed the bad version needs the higher one.

**Trust.** An update is checked against the SHA-512 in `latest.yml`, fetched over HTTPS. Anyone who can push a version tag to this repository
can publish an installer that every PC will offer to its administrator, so treat that as the key to all shops:
- keep the number of people with write access small, and use two-factor sign-in on their GitHub accounts;
- protect `main` and restrict who may create `v*` tags (GitHub: *Settings > Rules > Rulesets*);
- sign the installer (`CSC_LINK`, `CSC_KEY_PASSWORD`) before relying on this: it is the stronger protection. Signed updates have not been tested here.

## Hosted browser deployment

Vercel is a frontend host only. The current backend uses SQLite and requires durable filesystem storage, so do not deploy it to Vercel serverless functions or use ephemeral container storage. A hosted deployment must use one persistent Node backend instance with a durable volume, backups, monitoring, and TLS. SQLite is not configured for horizontal scaling or concurrent backend replicas. The old PostgreSQL hosting configurations in `legacy/` do not match this backend.

To configure Vercel:

- Set the project root to `frontend`, framework to Vite, and output directory to `dist`.
- Set `VITE_API_URL` to the public backend origin followed by `/api` in the Vercel Production environment.
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
