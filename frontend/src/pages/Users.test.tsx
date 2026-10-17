import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Users } from './Users';

const who = vi.hoisted(() => ({ role: 'MANAGER' }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { role: who.role } }, can: () => true, canAny: () => true }) }));

const user = (id: string, name: string, role: string, emailApprovalEnabled = false) => ({ id, name, email: `${name.toLowerCase()}@shop.test`, role, branchId: 'b1', isActive: true, lastLoginAt: null, emailApprovalEnabled, branch: { name: 'Main' } });
const people = [user('u1', 'Root', 'SUPER_ADMIN', true), user('u2', 'Mary', 'MANAGER', true), user('u3', 'Charles', 'CASHIER', true), user('u4', 'Aaron', 'AUDITOR')];

let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  who.role = 'MANAGER';
  calls = stubApi((url, { method }) => {
    if (url.startsWith('/users') && method === 'GET') return json(people);
    if (url === '/settings') return json({ currency: 'UGX', loginApprovalRequiredRoles: ['SUPER_ADMIN', 'MANAGER'] });
    if (url.startsWith('/branches')) return json([]);
    if (method === 'POST' || method === 'PATCH') return new Response(null, { status: 204 });
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const row = async (name: string) => within((await screen.findByText(name)).closest('tr')!);

describe('resetting passwords and correcting emails by role', () => {
  it('shows a manager reset buttons only for people ranked below them', async () => {
    renderApp(<Users />);
    const charles = await row('Charles');
    expect(charles.getByRole('button', { name: 'Reset password' })).toBeTruthy();
    expect(charles.getByRole('button', { name: 'Change email' })).toBeTruthy();
    const aaron = await row('Aaron');
    expect(aaron.getByRole('button', { name: 'Reset password' })).toBeTruthy();
    expect(aaron.getByRole('button', { name: 'Change email' })).toBeTruthy();
    for (const above of ['Mary', 'Root']) expect((await row(above)).queryByRole('button', { name: /Reset/ }), above).toBeNull();
  });

  it('lets a super admin reset managers too, but never another super admin', async () => {
    who.role = 'SUPER_ADMIN';
    renderApp(<Users />);
    expect((await row('Mary')).getByRole('button', { name: 'Reset password' })).toBeTruthy();
    expect((await row('Root')).queryByRole('button', { name: /Reset/ })).toBeNull();
  });

  it('resets a password only when both entries match and the password is long enough', async () => {
    renderApp(<Users />);
    fireEvent.click((await row('Charles')).getByRole('button', { name: 'Reset password' }));
    const dialog = within(await screen.findByRole('dialog'));
    const submit = dialog.getByRole('button', { name: 'Reset password' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(dialog.getByLabelText('Repeat new password'), { target: { value: 'short' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText('New password'), { target: { value: 'a-long-new-pass' } });
    fireEvent.change(dialog.getByLabelText('Repeat new password'), { target: { value: 'different-pass' } });
    expect(dialog.getByText(/do not match/i)).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Repeat new password'), { target: { value: 'a-long-new-pass' } });
    fireEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/users/u3/password')).toBe(true));
    expect(calls.find((c) => c.url === '/users/u3/password')!.body).toEqual({ password: 'a-long-new-pass' });
  });

  it('shows whether email approval is on, required for the role, or off', async () => {
    renderApp(<Users />);
    expect((await row('Charles')).getByText('On')).toBeTruthy(); // opted in
    expect((await row('Mary')).getByText('On')).toBeTruthy();
    await waitFor(async () => expect((await row('Aaron')).getByText('Off')).toBeTruthy());
  });

  it('changes a user’s email, only once it is a different address', async () => {
    renderApp(<Users />);
    fireEvent.click((await row('Charles')).getByRole('button', { name: 'Change email' }));
    const dialog = within(await screen.findByRole('dialog'));
    const submit = dialog.getByRole('button', { name: 'Change email' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // still the current address
    fireEvent.change(dialog.getByLabelText('New email'), { target: { value: ' Right@Shop.test ' } });
    fireEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url === '/users/u3/email')).toBe(true));
    expect(calls.find((c) => c.url === '/users/u3/email')!.body).toEqual({ email: 'Right@Shop.test' });
  });

  it('no longer offers a way to reset two-factor', async () => {
    renderApp(<Users />);
    await row('Charles');
    expect(screen.queryByRole('button', { name: /2FA/ })).toBeNull();
  });

  it('no longer offers a password field when editing an existing user', async () => {
    renderApp(<Users />);
    fireEvent.click(await screen.findByText('Aaron'));
    await screen.findByText('Edit user');
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });
});
