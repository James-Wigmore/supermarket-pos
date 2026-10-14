import {
  requestLoginApproval,
  approveLoginToken,
  claimApprovedLogin,
  rejectLoginToken,
} from './login-approval.service';

import bcrypt from 'bcryptjs';
import type { Role, User } from '@prisma/client';
import { env } from '../config/env';
import { audit } from '../lib/audit';
import { seal, unseal } from '../lib/crypto';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors';
import { can, P, ROLE_PERMISSIONS } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { getSettings } from '../lib/settings';
import { signToken, userFromScopedToken } from '../middleware/auth';
import type { Actor } from '../types';
import { checkSecondFactor, matchStep, newRecoveryCodes, newSecret, twoFactorLimiter } from './twofactor.service';
import { sendEmail } from './email.service';

// Compared against when the user does not exist, so timing does not reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

type Ctx = Pick<Actor, 'ip' | 'userAgent'>;
const CLEARED = { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecovery: null, twoFactorLastStep: null };

export const hashPassword = (password: string) => bcrypt.hash(password, env.BCRYPT_ROUNDS);

const isRequiredFor = async (role: Role) => (await getSettings()).twoFactorRequiredRoles.includes(role);

export const sessionInfo = async (actor: Actor) => {
  const branch = actor.branchId
    ? await prisma.branch.findUnique({ where: { id: actor.branchId }, select: { id: true, name: true, code: true } })
    : null;
  const row = await prisma.user.findUnique({ where: { id: actor.id }, select: { twoFactorEnabled: true } });
  return {
    user: { id: actor.id, name: actor.name, email: actor.email, role: actor.role, branchId: actor.branchId },
    branch,
    permissions: ROLE_PERMISSIONS[actor.role],
    twoFactor: { enabled: Boolean(row?.twoFactorEnabled), required: await isRequiredFor(actor.role) },
  };
};

const actorOf = (user: User, ctx: Ctx = {}): Actor => ({ id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, ...ctx });

const finishLogin = async (user: User, ctx: Ctx, method: 'password' | 'totp' | 'recovery') => {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const actor = actorOf(user, ctx);
  await audit(prisma, actor, { action: 'LOGIN', entity: 'User', entityId: user.id, after: { method } });
  return { token: signToken(user), ...(await sessionInfo(actor)) };
};

/** An authenticator secret that cannot be decrypted (e.g. data restored onto another PC) is cleared so the user can enrol again. */
const dropUnreadableSecret = async (user: User) => {
  if (!user.twoFactorEnabled || !user.twoFactorSecret) return user;
  try {
    unseal(user.twoFactorSecret);
    return user;
  } catch {
    await audit(prisma, actorOf(user), { action: 'TWO_FACTOR_RESET', entity: 'User', entityId: user.id, after: { reason: 'stored secret could not be read' } });
    return prisma.user.update({ where: { id: user.id }, data: CLEARED });
  }
};

/** Step 1 of signing in. Returns a session, or tells the client which second step is needed. */

export const login = async (
  email: string,
  password: string,
  ctx: Ctx,
) => {
  const found = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(
    password,
    found?.passwordHash ?? DUMMY_HASH,
  );

  if (!found || !valid || !found.isActive) {
    if (found) {
      await audit(prisma, null, {
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: found.id,
        after: { email, ...ctx },
      });
    }

    throw unauthorized('Invalid email or password');
  }

  const user = await dropUnreadableSecret(found);

  if (!user.twoFactorEnabled && await isRequiredFor(user.role)) {
    return {
      nextStep: 'setup' as const,
      setupToken: signToken(user, 'setup'),
    };
  }

  return requestLoginApproval({
    userId: user.id,
    email: user.email,
    approvalUrl: new URL(
      '/login-approval',
      env.APP_BASE_URL,
    ).toString(),
    context: ctx,
    sendEmail,
  });
};



/** Step 2: the authenticator (or a one-time recovery) code. */
export const verifyLogin = async (challengeToken: string, code: string, ctx: Ctx) => {
  const user = await userFromScopedToken(challengeToken, 'challenge');
  twoFactorLimiter.assertOpen(user.id);
  const check = checkSecondFactor(user, code);
  if (!check) {
    twoFactorLimiter.fail(user.id);
    await audit(prisma, null, { action: 'LOGIN_FAILED', entity: 'User', entityId: user.id, after: { reason: 'second factor', ...ctx } });
    throw unauthorized('That code is not valid');
  }
  twoFactorLimiter.clear(user.id);
  return finishLogin(await prisma.user.update({ where: { id: user.id }, data: check.data }), ctx, check.method);
};


export const confirmLoginApproval = async (token: string) =>
  approveLoginToken(token);

export const completeApprovedLogin = async (requestToken: string) => {
  const claimed = await claimApprovedLogin(requestToken);

  if (!claimed) {
    return { nextStep: 'emailApprovalPending' as const };
  }

  return finishLogin(
    claimed.user,
    claimed.context,
    'password',
  );
};


export const logout = (actor: Actor) => audit(prisma, actor, { action: 'LOGOUT', entity: 'User', entityId: actor.id });

/** Only managers and above change their own password; everyone else asks the manager above them. */
export const changePassword = async (actor: Actor, currentPassword: string, newPassword: string, code?: string) => {
  if (!can(actor.role, P.USER_MANAGE)) throw forbidden('Ask your manager to reset your password');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');

  let factorUpdate = {};
  if (user.twoFactorEnabled) {
    twoFactorLimiter.assertOpen(user.id);
    const check = code ? checkSecondFactor(user, code) : null;
    if (!check) {
      twoFactorLimiter.fail(user.id);
      throw badRequest('Enter a valid authenticator code to change your password');
    }
    twoFactorLimiter.clear(user.id);
    factorUpdate = check.data;
  }
  const updated = await prisma.user.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 }, ...factorUpdate },
  });
  await audit(prisma, actor, { action: 'PASSWORD_CHANGE', entity: 'User', entityId: actor.id });
  return { token: signToken(updated) };
};

/** Starts enrolment: returns the secret (for manual entry) and the otpauth URL (for the QR code). */
export const startTwoFactorSetup = async (actor: Actor) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.twoFactorEnabled) throw conflict('Two-factor authentication is already on');
  const { secret, otpauthUrl } = newSecret(user.email);
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: seal(secret) } });
  return { secret, otpauthUrl };
};

/** Finishes enrolment with a first valid code, switches 2FA on and returns the one-time recovery codes. */
export const confirmTwoFactorSetup = async (actor: Actor, code: string, ctx: Ctx, completeLogin: boolean) => {
  twoFactorLimiter.assertOpen(actor.id);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.twoFactorEnabled) throw conflict('Two-factor authentication is already on');
  if (!user.twoFactorSecret) throw badRequest('Start the setup first');
  const step = matchStep(unseal(user.twoFactorSecret), code.replace(/\s/g, ''), null);
  if (step === null) {
    twoFactorLimiter.fail(user.id);
    throw badRequest('That code is not valid. Check the clock on your phone and try again.');
  }
  twoFactorLimiter.clear(user.id);
  const { codes, stored } = newRecoveryCodes();
  const enabled = await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true, twoFactorLastStep: step, twoFactorRecovery: stored } });
  await audit(prisma, actor, { action: 'TWO_FACTOR_ENABLED', entity: 'User', entityId: user.id });
  return { recoveryCodes: codes, ...(completeLogin ? await finishLogin(enabled, ctx, 'totp') : {}) };
};

/** Users may switch their own 2FA off only when their role does not require it. */
export const disableTwoFactor = async (actor: Actor, password: string, code: string) => {
  if (await isRequiredFor(actor.role)) throw forbidden('Two-factor authentication is required for your role');
  twoFactorLimiter.assertOpen(actor.id);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!user.twoFactorEnabled) throw conflict('Two-factor authentication is not on');
  const check = (await bcrypt.compare(password, user.passwordHash)) ? checkSecondFactor(user, code) : null;
  if (!check) {
    twoFactorLimiter.fail(user.id);
    throw badRequest('The password or the code is not correct');
  }
  twoFactorLimiter.clear(user.id);
  await prisma.user.update({ where: { id: user.id }, data: CLEARED });
  await audit(prisma, actor, { action: 'TWO_FACTOR_DISABLED', entity: 'User', entityId: user.id });
};

export const clearTwoFactorData = CLEARED;

export const rejectLoginApproval = async (token: string) => {
  return rejectLoginToken(token);
};