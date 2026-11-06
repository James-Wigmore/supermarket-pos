import { activate, licenseStatus } from '../main/licenseStore';
import { handle } from './handle';

/** Anyone at the PC may see the code and enter a key: a key only works on the PC it was made for. */
export const registerLicenseIpc = () => {
  handle('license:status', () => licenseStatus());
  handle('license:activate', (_event, key: unknown) => {
    if (typeof key !== 'string' || key.length > 2000) throw new Error('Enter the activation key.');
    return activate(key);
  });
};
