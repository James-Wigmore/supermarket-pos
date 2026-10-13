import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Login } from './Login';

const auth = vi.hoisted(() => ({ login: vi.fn(), verifyCode: vi.fn(), startSession: vi.fn() }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: null, ...auth }) }));

const TOKEN = 'x'.repeat(40);
const renderLogin = (step?: unknown) => renderApp(<MemoryRouter initialEntries={[{ pathname: '/login', state: step ? { step } : undefined }]}><Login /></MemoryRouter>);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const signIn = () => { type('Email', ' ann@shop.test '); type('Password', 'pass-word-1'); fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); };

beforeEach(() => { stubBrowser(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('signing in', () => {
  it('sends the trimmed email and password and shows a wrong-password message', async () => {
    auth.login.mockRejectedValue(new Error('Invalid email or password'));
    renderLogin();
    signIn();
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid email or password/i);
    expect(auth.login).toHaveBeenCalledWith('ann@shop.test', 'pass-word-1');
    expect(screen.getByText(/ask your manager to reset it/i)).toBeTruthy();
  });

  it('asks for the authenticator code after the password and verifies it', async () => {
    auth.login.mockResolvedValue({ kind: 'code', challengeToken: TOKEN });
    auth.verifyCode.mockRejectedValueOnce(new Error('That code is not valid')).mockResolvedValueOnce(undefined);
    renderLogin();
    signIn();
    const verify = await screen.findByRole('button', { name: 'Verify' });
    expect((verify as HTMLButtonElement).disabled).toBe(true);
    type('Authenticator code', '123 456');
    fireEvent.click(verify);
    expect((await screen.findByRole('alert')).textContent).toMatch(/not valid/);
    expect(auth.verifyCode).toHaveBeenLastCalledWith(TOKEN, '123 456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(auth.verifyCode).toHaveBeenCalledTimes(2));
  });

  it('lets someone abandon the code step and start again', async () => {
    auth.login.mockResolvedValue({ kind: 'code', challengeToken: TOKEN });
    renderLogin();
    signIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different account' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });
});

describe('forced enrolment at sign-in', () => {
  const session = { token: 'session-token', user: { id: 'u1', name: 'Ann', email: 'ann@shop.test', role: 'MANAGER', branchId: 'b1' }, branch: null, permissions: [], twoFactor: { enabled: true, required: true } };
  const codes = ['AAAAA-BBBBB', 'CCCCC-DDDDD', 'EEEEE-FFFFF'];
  let calls: ReturnType<typeof stubApi>;
  beforeEach(() => {
    calls = stubApi((url, { method }) => {
      if (url === '/auth/2fa/setup' && method === 'POST') return json({ secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/Supermarket%20POS:ann@shop.test?secret=JBSWY3DPEHPK3PXP&issuer=Supermarket%20POS' });
      if (url === '/auth/2fa/confirm' && method === 'POST') return json({ recoveryCodes: codes, ...session });
      return undefined;
    });
  });

  it('shows a QR code and the manual key, then recovery codes, and only signs in after they are saved', async () => {
    auth.login.mockResolvedValue({ kind: 'setup', setupToken: TOKEN });
    renderLogin();
    signIn();
    expect(await screen.findByAltText('QR code for your authenticator app', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(calls.filter((c) => c.url === '/auth/2fa/setup')).toHaveLength(1); // one secret, even with re-renders
    expect(calls.find((c) => c.url === '/auth/2fa/setup')!.body).toEqual({ setupToken: TOKEN });

    const turnOn = screen.getByRole('button', { name: 'Turn on two-factor' }) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    type('6-digit code', '123456');
    fireEvent.click(turnOn);
    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(codes);
    expect(calls.find((c) => c.url === '/auth/2fa/confirm')!.body).toEqual({ code: '123456', setupToken: TOKEN });
    expect(auth.startSession).not.toHaveBeenCalled(); // not signed in until the codes are acknowledged

    const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have saved these codes/));
    fireEvent.click(next);
    expect(auth.startSession).toHaveBeenCalledWith(expect.objectContaining({ token: 'session-token' }));
  });

  it('opens straight on the enrolment screen when sent here from first-run setup', async () => {
    renderLogin({ kind: 'setup', setupToken: TOKEN });
    expect(await screen.findByText('Set up two-factor authentication')).toBeTruthy();
    expect(await screen.findByAltText('QR code for your authenticator app', undefined, { timeout: 3000 })).toBeTruthy();
  });
});
