import { env } from '../config/env';
import type { EmailMessage } from './email.service';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

const when = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: env.TIMEZONE }).format(date);

interface Details {
  to: string;
  name: string;
  storeName: string;
  approveUrl: string;
  rejectUrl: string;
  requestedAt: Date;
  minutes: number;
  ip?: string;
  userAgent?: string;
}

/** Plain text and HTML versions. The links open a confirmation page: they never approve on their own. */
export const approvalEmail = (d: Details): EmailMessage => {
  const rows: [string, string][] = [
    ['Account', d.to],
    ['Requested', `${when(d.requestedAt)} (${env.TIMEZONE})`],
    ['From address', d.ip ?? 'unknown'],
    ['Browser / device', (d.userAgent ?? 'unknown').slice(0, 120)],
  ];
  const text = [
    `Hello ${d.name},`,
    '',
    `Someone entered your password to sign in to ${d.storeName}.`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Approve this sign-in (valid for ${d.minutes} minutes):`,
    d.approveUrl,
    '',
    'Not you? Reject it, and ask your manager to reset your password:',
    d.rejectUrl,
  ].join('\n');
  const button = (href: string, label: string, color: string) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;margin:0 8px 8px 0;border-radius:8px;background:${color};color:#fff;text-decoration:none;font-weight:600">${label}</a>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;color:#111">
<p>Hello ${escapeHtml(d.name)},</p>
<p>Someone entered your password to sign in to <b>${escapeHtml(d.storeName)}</b>.</p>
<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#555">${k}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
<p>This request expires in ${d.minutes} minutes.</p>
<p>${button(d.approveUrl, 'Approve Login', '#15803d')}${button(d.rejectUrl, 'Reject Login', '#b91c1c')}</p>
<p style="font-size:13px;color:#555">Not you? Reject it and ask your manager to reset your password.</p></div>`;
  return { to: d.to, subject: `Approve your ${d.storeName} sign-in`, text, html };
};
