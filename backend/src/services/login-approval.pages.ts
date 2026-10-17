import { env } from '../config/env';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,Arial,sans-serif;background:#f4f4f5;margin:0;display:grid;min-height:100vh;place-items:center;padding:16px;color:#111}
main{background:#fff;border-radius:12px;padding:28px;max-width:420px;width:100%;box-shadow:0 1px 6px #0002}
h1{font-size:1.3rem;margin:0 0 12px}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:.9rem;margin:16px 0}dt{color:#555}dd{margin:0;word-break:break-word}
button{width:100%;padding:12px;border:0;border-radius:8px;color:#fff;font-size:1rem;font-weight:600;cursor:pointer}.approve{background:#15803d}.reject{background:#b91c1c}
.ok{color:#15803d}.bad{color:#b91c1c}p{line-height:1.5}</style></head><body><main>${body}</main></body></html>`;

interface Details { email: string; name: string; requestedAt: Date; ip: string | null; userAgent: string | null; secondsLeft: number }

/** Opening the emailed link only shows this page; nothing is decided until the button is pressed. */
export const confirmPage = (action: 'approve' | 'reject', token: string, d: Details) => {
  const approve = action === 'approve';
  const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: env.TIMEZONE }).format(d.requestedAt);
  return shell(approve ? 'Approve sign-in' : 'Reject sign-in', `<h1>${approve ? 'Approve this sign-in?' : 'Reject this sign-in?'}</h1>
<p>${approve ? 'Only approve if you just tried to sign in.' : 'Rejecting stops this sign-in. If it was not you, also ask your manager to reset your password.'}</p>
<dl><dt>Account</dt><dd>${escapeHtml(d.email)}</dd><dt>Requested</dt><dd>${escapeHtml(when)}</dd>
<dt>From address</dt><dd>${escapeHtml(d.ip ?? 'unknown')}</dd><dt>Device</dt><dd>${escapeHtml((d.userAgent ?? 'unknown').slice(0, 120))}</dd>
<dt>Expires in</dt><dd>${Math.ceil(d.secondsLeft / 60)} min</dd></dl>
<form method="post" action="/api/auth/${action}"><input type="hidden" name="token" value="${escapeHtml(token)}">
<button class="${action}" type="submit">${approve ? 'Approve Login' : 'Reject Login'}</button></form>`);
};

export const resultPage = (ok: boolean, title: string, message: string) =>
  shell(title, `<h1 class="${ok ? 'ok' : 'bad'}">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
