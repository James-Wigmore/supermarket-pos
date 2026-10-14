
import nodemailer from 'nodemailer';
import { env } from '../config/env';

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export const sendEmail = async ({
  to,
  subject,
  text,
}: EmailMessage): Promise<void> => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, EMAIL_FROM } =
    env;

  if (!SMTP_HOST || !EMAIL_FROM) {
    throw new Error('Email delivery is not configured');
  }

  if (Boolean(SMTP_USER) !== Boolean(SMTP_PASS)) {
    throw new Error('Both SMTP_USER and SMTP_PASS must be configured');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    ...(SMTP_USER && SMTP_PASS
      ? {
          auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
          },
        }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  await transporter.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    text,
  });
};
