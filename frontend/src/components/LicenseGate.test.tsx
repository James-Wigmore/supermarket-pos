import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseStatus, PosBridge } from '../../../desktop/bridge';
import { renderApp, stubBrowser } from '../test/utils';
import { LicenseGate } from './LicenseGate';

const status = (over: Partial<LicenseStatus> = {}): LicenseStatus =>
  ({ state: 'ok', graceDaysLeft: null, machineCode: 'AAAA-BBBB-CCCC-DDDD', shop: null, ...over });

const bridge = (current: LicenseStatus) => {
  const pos = { licenseStatus: vi.fn(async () => current), licenseActivate: vi.fn() };
  window.pos = pos as unknown as PosBridge;
  return pos;
};

beforeEach(() => { stubBrowser(); });
afterEach(() => { cleanup(); delete window.pos; vi.restoreAllMocks(); });

const fillKey = (value: string) => fireEvent.change(screen.getByLabelText('Activation key'), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

describe('LicenseGate', () => {
  it('passes straight through in a browser (no window.pos)', async () => {
    renderApp(<LicenseGate><div>App content</div></LicenseGate>);
    expect(await screen.findByText('App content')).toBeTruthy();
  });

  it('locks the whole app when activation is required, and unlocks on a valid key', async () => {
    const pos = bridge(status({ state: 'required', machineCode: 'AAAA-BBBB-CCCC-DDDD' }));
    pos.licenseActivate.mockResolvedValue(status({ state: 'ok' }));
    renderApp(<LicenseGate><div>App content</div></LicenseGate>);

    expect(await screen.findByText('Activate Supermarket POS')).toBeTruthy();
    expect(screen.queryByText('App content')).toBeNull();

    fillKey('a-valid-looking-activation-key-123');
    submit();

    await waitFor(() => expect(pos.licenseActivate).toHaveBeenCalledWith('a-valid-looking-activation-key-123'));
    expect(await screen.findByText('App content')).toBeTruthy();
  });

  it('shows an error and stays locked when the key is wrong', async () => {
    const pos = bridge(status({ state: 'required', machineCode: 'AAAA-BBBB-CCCC-DDDD' }));
    pos.licenseActivate.mockRejectedValue(new Error('That key does not match this computer.'));
    renderApp(<LicenseGate><div>App content</div></LicenseGate>);

    await screen.findByLabelText('Activation key');
    fillKey('a-wrong-key-but-long-enough-12345');
    submit();

    expect(await screen.findByText('That key does not match this computer.')).toBeTruthy();
    expect(screen.queryByText('App content')).toBeNull();
  });

  it('shows a grace-period banner with a countdown and lets the user activate from it', async () => {
    const pos = bridge(status({ state: 'grace', graceDaysLeft: 13, machineCode: 'AAAA-BBBB-CCCC-DDDD' }));
    pos.licenseActivate.mockResolvedValue(status({ state: 'ok' }));
    renderApp(<LicenseGate><div>App content</div></LicenseGate>);

    expect(await screen.findByText(/Activate this copy within 13 days/)).toBeTruthy();
    expect(await screen.findByText('App content')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Activate now' }));
    expect(await screen.findByText('Activate this computer')).toBeTruthy();

    fillKey('a-valid-looking-activation-key-123');
    submit();

    await waitFor(() => expect(pos.licenseActivate).toHaveBeenCalledWith('a-valid-looking-activation-key-123'));
  });
});
