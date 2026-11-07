import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LicenseGate } from './LicenseGate';

const renderGate = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LicenseGate>
        <div>App content</div>
      </LicenseGate>
    </QueryClientProvider>,
  );
};

describe('LicenseGate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes straight through in a browser (no window.pos)', async () => {
    vi.stubGlobal('pos', undefined);
    renderGate();
    expect(await screen.findByText('App content')).toBeInTheDocument();
  });

  it('locks the whole app when activation is required, and unlocks on a valid key', async () => {
    const user = userEvent.setup();
    const licenseActivate = vi.fn().mockResolvedValue({ state: 'ok', graceDaysLeft: null, machineCode: 'AAAA-BBBB-CCCC-DDDD' });
    vi.stubGlobal('pos', {
      licenseStatus: vi.fn().mockResolvedValue({ state: 'required', graceDaysLeft: null, machineCode: 'AAAA-BBBB-CCCC-DDDD' }),
      licenseActivate,
    });
    renderGate();

    expect(await screen.findByText('Activate Supermarket POS')).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Activation key'), 'a-valid-looking-activation-key-123');
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    expect(licenseActivate).toHaveBeenCalledWith('a-valid-looking-activation-key-123');
    expect(await screen.findByText('App content')).toBeInTheDocument();
  });

  it('shows an error and stays locked when the key is wrong', async () => {
    const user = userEvent.setup();
    const licenseActivate = vi.fn().mockRejectedValue(new Error('That key does not match this computer.'));
    vi.stubGlobal('pos', {
      licenseStatus: vi.fn().mockResolvedValue({ state: 'required', graceDaysLeft: null, machineCode: 'AAAA-BBBB-CCCC-DDDD' }),
      licenseActivate,
    });
    renderGate();

    await user.type(await screen.findByLabelText('Activation key'), 'a-wrong-key-but-long-enough-12345');
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    expect(await screen.findByText('That key does not match this computer.')).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
  });

  it('shows a grace-period banner with a countdown and lets the user activate from it', async () => {
    const user = userEvent.setup();
    const licenseActivate = vi.fn().mockResolvedValue({ state: 'ok', graceDaysLeft: null, machineCode: 'AAAA-BBBB-CCCC-DDDD' });
    vi.stubGlobal('pos', {
      licenseStatus: vi.fn().mockResolvedValue({ state: 'grace', graceDaysLeft: 13, machineCode: 'AAAA-BBBB-CCCC-DDDD' }),
      licenseActivate,
    });
    renderGate();

    expect(await screen.findByText(/Activate this copy within 13 days/)).toBeInTheDocument();
    expect(await screen.findByText('App content')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Activate now' }));
    expect(await screen.findByText('Activate this computer')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Activation key'), 'a-valid-looking-activation-key-123');
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    expect(licenseActivate).toHaveBeenCalledWith('a-valid-looking-activation-key-123');
  });
});
