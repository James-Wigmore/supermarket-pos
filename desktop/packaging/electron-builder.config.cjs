/* Windows installer settings for electron-builder. Run through `npm run desktop:package` (see packaging/stage.mjs). */
const { version: electronVersion } = require('electron/package.json');

/*
 * Automatic updates: UPDATE_FEED_REPO is "owner/repository" of the PUBLIC GitHub repository whose Releases hold the installers
 * (the release workflow sets it to this repository; see DEPLOYMENT.md). Left empty, the build has no update source and
 * behaves exactly as it did before updates existed.
 */
const test = process.env.POS_CHANNEL === 'test'; // test installer: own identity, own data folder, no update source
const feed = test ? '' : (process.env.UPDATE_FEED_REPO ?? '').trim();
const name = test ? 'Supermarket POS TEST' : 'Supermarket POS';
if (feed && !/^[\w.-]+\/[\w.-]+$/.test(feed)) throw new Error(`UPDATE_FEED_REPO must look like "owner/repository", not "${feed}".`);
const [owner, repo] = feed.split('/');

module.exports = {
  appId: test ? 'com.supermarketpos.desktop.test' : 'com.supermarketpos.desktop',
  productName: name,
  electronVersion,
  // The app is assembled in `stage` first; the installer lands in `release`.
  directories: { app: 'stage', output: 'release', buildResources: 'packaging' },
  // Native SQLite binaries are unpacked; the rest of the application is archived.
  asar: true,
  extraResources: [
    { from: 'stage/node_modules/.prisma', to: 'app.asar.unpacked/node_modules/.prisma', filter: ['**/*'] },
    { from: 'stage/node_modules/@prisma', to: 'app.asar.unpacked/node_modules/@prisma', filter: ['**/*'] },
  ],
  asarUnpack: ['node_modules/better-sqlite3/**'],
  // Native modules were already rebuilt for Electron when the app was staged.
  npmRebuild: false,
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'icon.png' },
  nsis: {
    oneClick: false,
    // Per-user install: no administrator rights needed, and the program folder holds no data.
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createStartMenuShortcut: true,
    createDesktopShortcut: true,
    shortcutName: name,
    uninstallDisplayName: name,
    // Sales and settings live in %APPDATA%\supermarket-pos (supermarket-pos-test for test builds) and survive updates, re-installs and uninstalling.
    deleteAppDataOnUninstall: false,
    artifactName: test ? 'Supermarket-POS-TEST-Setup.${ext}' : 'Supermarket-POS-Setup.${ext}',
    // The installer keeps one fixed file name, so updates are always downloaded whole (no per-version block map).
    differentialPackage: false,
  },
  // Written into the app as app-update.yml, together with latest.yml next to the installer, when a feed is set.
  publish: feed ? { provider: 'github', owner, repo, releaseType: 'release' } : null,
};
