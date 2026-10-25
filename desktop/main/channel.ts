import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "test" builds (npm run desktop:dev, npm run desktop:test, or a manual run of the installer workflow) get their own data folder,
 * app identity and backups, and never look for updates, so trying a change can never touch the shop's real installation.
 * The packaged installer carries the marker in channel.json; a development run sets POS_CHANNEL=test.
 */
const marked = () => {
  try { return JSON.parse(readFileSync(join(app.getAppPath(), 'channel.json'), 'utf8')).channel === 'test'; } catch { return false; }
};
export const isTest = process.env.POS_CHANNEL === 'test' || marked();
export const channel = isTest
  ? { isTest, folder: 'supermarket-pos-test', appId: 'com.supermarketpos.desktop.test', name: 'Supermarket POS TEST' }
  : { isTest, folder: 'supermarket-pos', appId: 'com.supermarketpos.desktop', name: 'Supermarket POS' };
