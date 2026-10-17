import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Email approval needs a mail server, a sender and the public address of this backend for the links. Read at call time. */
export const emailApprovalConfigStatus = () => {
  const missing = ['SMTP_HOST', 'EMAIL_FROM', 'PUBLIC_BASE_URL'].filter((key) => !env[key as keyof typeof env]);
  return { configured: missing.length === 0, missing };
};

export const emailConfigured = () => emailApprovalConfigStatus().configured;

let cached: { key: string; transporter: Transporter } | null = null;

const transport = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = env;
  const key = JSON.stringify([SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE]);
  if (cached?.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        ...(SMTP_USER && SMTP_PASS ? { auth: { user: SMTP_USER, pass: SMTP_PASS } } : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }),
    };
  }
  return cached.transporter;
};

/** A description of a mail failure that is safe to log and store: never contains the SMTP user or password. */
export const describeEmailError = (err: unknown) => {
  const e = err as { code?: string; responseCode?: number; message?: string };
  let text = [e?.code, e?.responseCode, e?.message].filter(Boolean).join(' ').slice(0, 300);
  for (const secret of [env.SMTP_PASS, env.SMTP_USER]) if (secret) text = text.split(secret).join('***');
  return text || 'unknown error';
};

export const sendEmail = async ({ to, subject, text, html }: EmailMessage) => {
  if (!emailConfigured()) throw new Error('Email delivery is not configured');
  await transport().sendMail({ from: env.EMAIL_FROM, to, subject, text, html });
};

/** Checks the mail server at start-up. A failure is logged, not fatal: the server may only be briefly down. */
export const checkEmailTransport = async () => {
  if (!emailConfigured()) return false;
  try {
    await transport().verify();
    logger.info(`Email login approval is ON (mail server ${env.SMTP_HOST}:${env.SMTP_PORT} reachable)`);
    return true;
  } catch (err) {
    logger.error(`Email login approval is configured but the mail server check failed: ${describeEmailError(err)}`);
    return false;
  }
};
