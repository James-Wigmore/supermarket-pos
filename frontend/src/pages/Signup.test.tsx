import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Signup } from './Signup';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: null, login: vi.fn() }) }));

let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  calls = stubApi((url) => (url === '/auth/branches' ? json([{ id: 'b1', name: 'Main Branch' }, { id: 'b2', name: 'Kololo' }]) : undefined));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('creating an account', () => {
  it('lists the branches from the public endpoint, so the field works before anyone is signed in', async () => {
    renderApp(<MemoryRouter><Signup /></MemoryRouter>);
    expect(await screen.findByRole('option', { name: 'Kololo' })).toBeTruthy();
    expect((screen.getByLabelText('Branch') as HTMLSelectElement).disabled).toBe(false);
    expect(calls.some((c) => c.url === '/auth/branches')).toBe(true);
    expect(calls.some((c) => c.url === '/branches')).toBe(false);
  });
});
