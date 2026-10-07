/* Windows installer settings for electron-builder. Run through `npm run desktop:package` (see packaging/stage.mjs). */
const { version: electronVersion } = require('electron/package.json');

module.exports = {
  appId: 'com.supermarketpos.desktop',
  productName: 'Supermarket POS',
  electronVersion,
  // The app is assembled in `stage` first; the installer lands in `release`.
  directories: { app: 'stage', output: 'release', buildResources: 'packaging' },
  // Plain files (no asar archive): the UI is served from disk and native modules load without unpacking.
  asar: false,
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
    shortcutName: 'Supermarket POS',
    uninstallDisplayName: 'Supermarket POS',
    // Sales and settings live in %APPDATA%\supermarket-pos and survive updates, re-installs and uninstalling.
    deleteAppDataOnUninstall: false,
    artifactName: 'Supermarket-POS-Setup.${ext}',
  },
  // Updates are not enabled in the first release (see README, "Adding automatic updates").
  publish: null,
};
