import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { renderApp, stubBrowser } from '../test/utils';
import { Login } from './Login';

const auth = vi.hoisted(() => ({ login: vi.fn(), checkApproval: vi.fn(), cancelApproval: vi.fn() }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: null, ...auth }) }));

const TOKEN = 'x'.repeat(40);
const pending = { kind: 'emailApproval', requestToken: TOKEN, secondsLeft: 300, emailHint: 'a***@shop.test' };
const renderLogin = (step?: unknown) => renderApp(<MemoryRouter initialEntries={[{ pathname: '/login', state: step ? { step } : undefined }]}><Login /></MemoryRouter>);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const signIn = async () => {
  type('Email', ' ann@shop.test '); type('Password', 'pass-word-1');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
};
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { stubBrowser(); vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('signing in', () => {
  it('sends the trimmed email and password and shows a wrong-password message', async () => {
    auth.login.mockRejectedValue(new Error('Invalid email or password'));
    renderLogin();
    await signIn();
    expect(screen.getByRole('alert').textContent).toMatch(/invalid email or password/i);
    expect(auth.login).toHaveBeenCalledWith('ann@shop.test', 'pass-word-1');
    expect(screen.getByText(/ask your manager to reset it/i)).toBeTruthy();
  });

  it('shows a clear message when the approval email cannot be sent, and stays on the form', async () => {
    auth.login.mockRejectedValue(new ApiError(503, "We couldn't send the approval email. Try again in a moment.", 'EMAIL_DELIVERY_FAILED'));
    renderLogin();
    await signIn();
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't send the approval email/i);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('waiting for the emailed approval', () => {
  const toPending = async () => {
    auth.login.mockResolvedValue(pending);
    renderLogin();
    await signIn();
  };

  it('shows where the email went and a countdown, and checks the status on a timer', async () => {
    auth.checkApproval.mockResolvedValue({ status: 'PENDING', secondsLeft: 297 });
    await toPending();
    expect(screen.getByText('a***@shop.test')).toBeTruthy();
    expect(screen.getByLabelText('Time left').textContent).toBe('5:00');
    expect(auth.checkApproval).not.toHaveBeenCalled();
    await tick(3000);
    expect(auth.checkApproval).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByLabelText('Time left').textContent).toBe('4:57');
    await tick(3000);
    expect(auth.checkApproval).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['REJECTED', /was rejected/i],
    ['EXPIRED', /expired/i],
    ['CANCELLED', /cancelled/i],
  ])('stops checking and offers to sign in again when the request is %s', async (status, message) => {
    auth.checkApproval.mockResolvedValue({ status, secondsLeft: 0 });
    await toPending();
    await tick(3000);
    expect(screen.getByRole('alert').textContent).toMatch(message);
    await tick(20_000);
    expect(auth.checkApproval).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('lets the person cancel: tells the server, stops checking and returns to the form', async () => {
    auth.checkApproval.mockResolvedValue({ status: 'PENDING', secondsLeft: 290 });
    auth.cancelApproval.mockResolvedValue(undefined);
    await toPending();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' })); });
    expect(auth.cancelApproval).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    await tick(20_000);
    expect(auth.checkApproval).not.toHaveBeenCalled();
  });

  it('keeps waiting through a network error, backing off, and recovers', async () => {
    auth.checkApproval.mockRejectedValueOnce(new ApiError(0, 'Cannot reach the server')).mockResolvedValue({ status: 'PENDING', secondsLeft: 250 });
    await toPending();
    await tick(3000);
    expect(screen.getByRole('alert').textContent).toMatch(/cannot reach the server/i);
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeTruthy();
    await tick(3000); // backed off: the retry is not due yet
    expect(auth.checkApproval).toHaveBeenCalledTimes(1);
    await tick(3000);
    expect(auth.checkApproval).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops on a definite error such as an unknown request', async () => {
    auth.checkApproval.mockRejectedValue(new ApiError(404, 'This sign-in request is no longer available. Sign in again.', 'APPROVAL_NOT_FOUND'));
    await toPending();
    await tick(3000);
    expect(screen.getByRole('alert').textContent).toMatch(/no longer available/i);
    await tick(60_000);
    expect(auth.checkApproval).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
  });

  it('stops checking when the screen is closed', async () => {
    auth.checkApproval.mockResolvedValue({ status: 'PENDING', secondsLeft: 290 });
    await toPending();
    cleanup();
    await tick(30_000);
    expect(auth.checkApproval).not.toHaveBeenCalled();
  });

  it('opens straight on the waiting screen when sent here from first-run setup', () => {
    renderLogin(pending);
    expect(screen.getByText('Approve your sign-in')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeTruthy();
  });
});
