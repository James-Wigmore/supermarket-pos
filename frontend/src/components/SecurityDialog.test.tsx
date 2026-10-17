import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, stubApi, stubBrowser } from '../test/utils';
import { SecurityDialog } from './SecurityDialog';

const NOT_SET_UP = { configured: false, required: false, optedIn: false, enabled: false };
const state = vi.hoisted(() => ({ canManage: true, loginApproval: {} as Record<string, boolean>, reloadSession: vi.fn() }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { loginApproval: state.loginApproval }, can: () => state.canManage, reloadSession: state.reloadSession }) }));

let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  state.canManage = true; state.loginApproval = { configured: true, required: false, optedIn: false, enabled: false }; state.reloadSession.mockReset();
  calls = stubApi((url, { method }) => (url === '/auth/email-approval' && method === 'POST' ? new Response(null, { status: 204 }) : undefined));
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

  it('says plainly that email approval is not running when the server has no email set up', () => {
    state.loginApproval = NOT_SET_UP;
    renderApp(<SecurityDialog onClose={() => undefined} />);
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getByText(/not set up on this server/i).textContent).toMatch(/password only/i);
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
  });

  it('turns approval on with the password and refreshes the session', async () => {
    renderApp(<SecurityDialog onClose={() => undefined} />);
    expect(screen.getByText('Off')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    const confirm = (await screen.findByRole('button', { name: 'Turn on approval' })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'my-password' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(state.reloadSession).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/auth/email-approval')!.body).toEqual({ enabled: true, password: 'my-password' });
  });

  it('can be cancelled without sending anything', async () => {
    renderApp(<SecurityDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeTruthy();
    expect(calls.some((c) => c.url === '/auth/email-approval')).toBe(false);
  });

  it('does not allow turning it off when the role requires it', () => {
    state.loginApproval = { configured: true, required: true, optedIn: false, enabled: true };
    renderApp(<SecurityDialog onClose={() => undefined} />);
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(screen.getByText(/required for your role/i)).toBeTruthy();
  });

  it('turns an optional approval off with the password', async () => {
    state.loginApproval = { configured: true, required: false, optedIn: true, enabled: true };
    renderApp(<SecurityDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off approval' }));
    await waitFor(() => expect(state.reloadSession).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/auth/email-approval')!.body).toEqual({ enabled: false, password: 'my-password' });
  });
});
