import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, renderApp, stubApi, stubBrowser } from '../test/utils';
import { SecurityDialog } from './SecurityDialog';

const state = vi.hoisted(() => ({ canManage: true, twoFactor: { enabled: false, required: false }, reloadSession: vi.fn() }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { twoFactor: state.twoFactor }, can: () => state.canManage, reloadSession: state.reloadSession }) }));

let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  state.canManage = true; state.twoFactor = { enabled: false, required: false }; state.reloadSession.mockReset();
  calls = stubApi((url, { method }) => (url === '/auth/2fa/disable' && method === 'POST' ? new Response(null, { status: 204 }) : url === '/auth/2fa/setup' ? json({ secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }) : undefined));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('account security', () => {
  it('sends staff below manager to their manager instead of offering a password change', () => {
    state.canManage = false;
    renderApp(<SecurityDialog onClose={() => undefined} />);
    expect(screen.getByText(/ask your manager/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
  });

  it('lets managers change their own password', () => {
    renderApp(<SecurityDialog onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy();
  });

  it('offers to turn two-factor on and starts the enrolment', async () => {
    renderApp(<SecurityDialog onClose={() => undefined} />);
    expect(screen.getByText('Off')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('button', { name: 'Turn on two-factor' })).toBeTruthy();
    expect(calls.some((c) => c.url === '/auth/2fa/setup')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeTruthy();
  });

  it('does not allow turning it off when the role requires it', () => {
    state.twoFactor = { enabled: true, required: true };
    renderApp(<SecurityDialog onClose={() => undefined} />);
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(screen.getByText(/required for your role/i)).toBeTruthy();
  });

  it('turns it off with the password and a code, then refreshes the session', async () => {
    state.twoFactor = { enabled: true, required: false };
    renderApp(<SecurityDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const confirm = (await screen.findByRole('button', { name: 'Turn off two-factor' })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'my-password' } });
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '654321' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(state.reloadSession).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/auth/2fa/disable')!.body).toEqual({ password: 'my-password', code: '654321' });
  });
});
