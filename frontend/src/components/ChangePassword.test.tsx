import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../lib/api';
import { json, renderApp, stubApi, stubBrowser } from '../test/utils';
import { ChangePassword } from './ChangePassword';

let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  localStorage.clear();
  calls = stubApi((url, { method }) => (url === '/auth/change-password' && method === 'POST' ? json({ token: 'fresh-token' }) : undefined));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement;

describe('change own password', () => {
  it('stays disabled until the new password is long enough and repeated correctly', () => {
    renderApp(<ChangePassword onClose={() => undefined} />);
    expect(submit().disabled).toBe(true);
    fill('Current password', 'old-pass'); fill('New password', 'short');
    expect(screen.getByText(/at least 8 characters/i, { selector: 'p.text-danger' })).toBeTruthy();
    fill('New password', 'a-better-pass'); fill('Repeat new password', 'different');
    expect(screen.getByText(/do not match/i)).toBeTruthy();
    expect(submit().disabled).toBe(true);
    fill('Repeat new password', 'a-better-pass');
    expect(submit().disabled).toBe(false);
  });

  it('sends the passwords, keeps the fresh session token and closes', async () => {
    const onClose = vi.fn();
    renderApp(<ChangePassword onClose={onClose} />);
    fill('Current password', 'old-pass'); fill('New password', 'a-better-pass'); fill('Repeat new password', 'a-better-pass');
    fireEvent.click(submit());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/auth/change-password')!.body).toEqual({ currentPassword: 'old-pass', newPassword: 'a-better-pass' });
    expect(tokenStore.get()).toBe('fresh-token');
  });

  it('shows the server message when the current password is wrong and keeps the old token', async () => {
    tokenStore.set('old-token');
    stubApi(() => json({ error: { message: 'Current password is incorrect' } }, 400));
    const onClose = vi.fn();
    renderApp(<ChangePassword onClose={onClose} />);
    fill('Current password', 'wrong'); fill('New password', 'a-better-pass'); fill('Repeat new password', 'a-better-pass');
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toMatch(/incorrect/);
    expect(onClose).not.toHaveBeenCalled();
    expect(tokenStore.get()).toBe('old-token');
  });
});
