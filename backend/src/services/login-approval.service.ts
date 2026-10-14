
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { unauthorized } from '../lib/errors';

const TOKEN_TTL_MS = 5 * 60 * 1000;

type ApprovalContext = {
  ip?: string;
  userAgent?: string;
};

type SendEmail = (message: {
  to: string;
  subject: string;
  text: string;
}) => Promise<void>;

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const validToken = (token: string) => /^[a-f0-9]{64}$/i.test(token);

export const requestLoginApproval = async (input: {
  userId: string;
  email: string;
  approvalUrl: string;
  context: ApprovalContext;
  sendEmail: SendEmail;
}) => {
  const token = randomBytes(32).toString('hex');
  const requestToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const url = new URL(input.approvalUrl);
  url.searchParams.set('token', token);

  await prisma.loginApproval.create({
    data: {
      userId: input.userId,
      tokenHash,
      requestTokenHash: hashToken(requestToken),
      status: 'PENDING',
      expiresAt,
      ip: input.context.ip,
      userAgent: input.context.userAgent,
    },
  });

  try {
    await input.sendEmail({
      to: input.email,
      subject: 'Approve your POS login',
      text: [
        'A login attempt requires your approval.',
        '',
        'Open this link to review and approve or reject the request:',
        url.toString(),
        '',
        'The link expires in five minutes.',
        'If you did not request this login, reject it.',
      ].join('\n'),
    });
  } catch {
    await prisma.loginApproval.updateMany({
      where: { tokenHash, status: 'PENDING' },
      data: { status: 'FAILED', consumedAt: new Date() },
    });
    throw new Error('Unable to send login approval email');
  }

  return {
    nextStep: 'emailApproval' as const,
    requestToken,
  };
};

export const approveLoginToken = async (token: string) => {
  if (!validToken(token)) {
    throw unauthorized('Approval link is invalid or expired');
  }

  const now = new Date();
  const result = await prisma.loginApproval.updateMany({
    where: {
      tokenHash: hashToken(token),
      status: 'PENDING',
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      status: 'APPROVED',
      approvedAt: now,
      consumedAt: now,
    },
  });

  if (result.count !== 1) {
    throw unauthorized('Approval link is invalid, expired, or already used');
  }

  return { message: 'Login approved. Return to the requesting device.' };
};

export const rejectLoginToken = async (token: string) => {
  if (!validToken(token)) {
    throw unauthorized('Approval link is invalid or expired');
  }

  const result = await prisma.loginApproval.updateMany({
    where: {
      tokenHash: hashToken(token),
      status: 'PENDING',
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      status: 'REJECTED',
      consumedAt: new Date(),
    },
  });

  if (result.count !== 1) {
    throw unauthorized('Approval link is invalid, expired, or already used');
  }

  return { message: 'Login request rejected' };
};

export const claimApprovedLogin = async (requestToken: string) => {
  if (!validToken(requestToken)) {
    throw unauthorized('Login request is invalid or expired');
  }

  const now = new Date();
  const approval = await prisma.loginApproval.findFirst({
    where: {
      requestTokenHash: hashToken(requestToken),
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      userId: true,
      status: true,
      ip: true,
      userAgent: true,
    },
  });

  if (!approval) {
    throw unauthorized('Login request is invalid or expired');
  }

  if (approval.status === 'PENDING') return null;

  if (approval.status !== 'APPROVED') {
    throw unauthorized('Login request has already been completed or rejected');
  }

  const user = await prisma.user.findFirst({
    where: { id: approval.userId, isActive: true },
  });

  if (!user) {
    throw unauthorized('This account is unavailable');
  }

  const claimed = await prisma.loginApproval.updateMany({
    where: {
      id: approval.id,
      status: 'APPROVED',
      expiresAt: { gt: now },
    },
    data: { status: 'COMPLETED' },
  });

  if (claimed.count !== 1) {
    throw unauthorized('Login request has already been completed');
  }

  return {
    user,
    context: {
      ip: approval.ip ?? undefined,
      userAgent: approval.userAgent ?? undefined,
    },
  };
};
