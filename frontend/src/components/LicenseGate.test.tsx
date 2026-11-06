import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseStatus, PosBridge } from '../../../desktop/bridge';
import { renderApp, stubBrowser } from '../test/utils';
import { LicenseGate } from './LicenseGate';

const status = (over: Partial<LicenseStatus> = {}): LicenseStatus => ({ state: 'required', machineCode: '7F3A-91BC-0D42-E8A5', shop: null, graceDaysLeft: null, ...over });
const bridge = (current: LicenseStatus, activate = vi.fn()) => {
  window.pos = { licenseStatus: vi.fn(async () => current), licenseActivate: activate } as unknown as PosBridge;
  return activate;
};
const open = () => renderApp(<LicenseGate><p>The till</p></LicenseGate>);

beforeEach(stubBrowser);
afterEach(() => { cleanup(); delete window.pos; vi.restoreAllMocks(); });

describe('activating the desktop app', () => {
  it('does not get in the way in a browser', () => {
    open();
    expect(screen.getByText('The till')).toBeTruthy();
  });

  it('locks a new copy, shows the PC code, and unlocks after a valid key', async () => {
    const activate = bridge(status(), vi.fn(async () => status({ state: 'ok', shop: 'Mama Sarah' })));
    open();
    expect(await screen.findByText('7F3A-91BC-0D42-E8A5')).toBeTruthy();
    expect(screen.queryByText('The till')).toBeNull();
    fireEvent.change(screen.getByLabelText('Activation key'), { target: { value: 'a'.repeat(30) } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(await screen.findByText('The till')).toBeTruthy();
    expect(activate).toHaveBeenCalledWith('a'.repeat(30));
  });

  it('shows why a wrong key failed and stays locked', async () => {
    bridge(status(), vi.fn(async () => { throw new Error('This key is not valid for this computer.'); }));
    open();
    fireEvent.change(await screen.findByLabelText('Activation key'), { target: { value: 'b'.repeat(30) } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(await screen.findByText(/not valid for this computer/)).toBeTruthy();
    expect(screen.queryByText('The till')).toBeNull();
  });

  it('lets an existing shop keep working during the grace period, with a countdown', async () => {
    bridge(status({ state: 'grace', graceDaysLeft: 9 }));
    open();
    await waitFor(() => expect(screen.getByText('The till')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toContain('within 9 days');
  });
});
