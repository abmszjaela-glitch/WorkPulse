import { randomUUID, timingSafeEqual } from 'node:crypto';
import isEmail from 'validator/lib/isEmail.js';
import { ApiError } from '../utils/api-error.js';
import { validatePassword, hashPassword, comparePassword } from './passwords.js';
import { createTokenService, opaqueToken, tokenHash } from './tokens.js';

export function safeUser(user) {
  return { id: user.id, email: user.email, role: user.role, mustChangePassword: user.must_change_password };
}

export function createAuthService({ repository, config, mailer, now = () => Date.now() }) {
  const tokens = createTokenService(config);
  const dummyHash = hashPassword(opaqueToken(), config.bcryptRounds);
  const invalid = () => new ApiError(401, 'Invalid credentials');
  const available = (user) => user?.is_active && (!user.must_change_password
    || !user.temporary_expires_at || Date.parse(user.temporary_expires_at) > now());
  const expiry = (seconds) => new Date(now() + seconds * 1000).toISOString();

  async function issue(user, deviceId = null) {
    const refreshToken = opaqueToken();
    const session = { id: randomUUID(), user_id: user.id, device_id: deviceId,
      auth_version: user.auth_version, expires_at: expiry(config.refreshSeconds) };
    await repository.createSession(session, { token_hash: tokenHash(refreshToken), session_id: session.id, expires_at: session.expires_at });
    return response(user, session, refreshToken);
  }

  function response(user, session, refreshToken) {
    return { accessToken: tokens.sign(user, session), refreshToken, tokenType: 'Bearer',
      expiresIn: config.accessSeconds, user: safeUser(user),
      ...(session.device_id ? { deviceId: session.device_id, role: 'Agent' } : {}) };
  }

  async function admin(actor) {
    const user = actor?.kind === 'user' && await repository.getUser(actor.userId);
    if (!available(user) || user.role !== 'A' || user.must_change_password) throw new ApiError(403, 'Forbidden');
    return user;
  }

  async function notify(method, email) {
    // Notification failure must not roll back an already committed security change.
    try { await mailer[method](email); } catch { console.error('Account notification delivery unavailable'); }
  }

  return {
    async login(email, password) {
      const user = await repository.findUserByEmail(email.trim().toLowerCase());
      const matches = await comparePassword(password, user?.password_hash || await dummyHash);
      if (!matches || !available(user)) throw invalid();
      return issue(user);
    },
    async authenticate(token) {
      const claims = tokens.verify(token);
      const [user, session] = await Promise.all([repository.getUser(claims.sub), repository.getSession(claims.sid)]);
      if (!available(user) || !session || session.user_id !== user.id || session.revoked_at
          || Date.parse(session.expires_at) <= now() || user.auth_version !== claims.version
          || session.auth_version !== user.auth_version || (session.device_id || null) !== (claims.device_id || null)) throw invalid();
      if (session.device_id) {
        const device = await repository.getDevice(session.device_id);
        if (!device?.is_active || device.user_id !== user.id) throw invalid();
      }
      return Object.freeze({ userId: user.id, sessionId: session.id, role: session.device_id ? 'Agent' : user.role,
        kind: session.device_id ? 'device' : 'user', deviceId: session.device_id || null,
        mustChangePassword: user.must_change_password });
    },
    async me(context) {
      const user = await repository.getUser(context.userId);
      return { user: safeUser(user), ...(context.deviceId ? { deviceId: context.deviceId, role: 'Agent' } : {}) };
    },
    async logout(context) { await repository.revokeSession(context.sessionId); },
    async refresh(token) {
      const replacement = opaqueToken();
      const result = await repository.rotateRefresh(tokenHash(token), { token_hash: tokenHash(replacement) });
      if (result?.status !== 'ok') throw new ApiError(401, 'Invalid or expired refresh token');
      const user = await repository.getUser(result.session.user_id);
      if (!available(user)) throw invalid();
      return response(user, result.session, replacement);
    },
    async registerEmployee(actor, { email, password, role = 'E', temporary = false }) {
      await admin(actor);
      if (typeof email !== 'string' || !isEmail(email) || email.length > 254 || !['A', 'M', 'E'].includes(role)) {
        throw new ApiError(400, 'Invalid employee details');
      }
      validatePassword(password);
      const user = await repository.createUser({ id: randomUUID(), created_by: actor.userId,
        email: email.trim().toLowerCase(), password_hash: await hashPassword(password, config.bcryptRounds),
        role, must_change_password: temporary, temporary_expires_at: temporary ? expiry(config.temporarySeconds) : null });
      await notify('sendAccountCreated', user.email);
      return safeUser(user);
    },
    async forgotPassword(email) {
      mailer.assertResetReady();
      const user = await repository.findUserByEmail(email.trim().toLowerCase());
      if (!user?.is_active) return;
      const token = opaqueToken();
      await repository.storeReset({ user_id: user.id, token_hash: tokenHash(token), expires_at: expiry(config.resetSeconds) });
      // Suppress recipient-specific delivery failures to prevent account enumeration.
      // No success claim about delivery is returned; SMTP configuration failures are global.
      try { await mailer.sendPasswordReset(user.email, token); } catch { console.error('Password recovery delivery failed'); }
    },
    async resetPassword(token, password) {
      validatePassword(password);
      const result = await repository.resetPassword(tokenHash(token), await hashPassword(password, config.bcryptRounds));
      if (!result) {
        throw new ApiError(400, 'Invalid or expired password reset token');
      }
      await notify('sendPasswordChanged', result.email);
    },
    async changePassword(context, currentPassword, newPassword) {
      if (context.kind !== 'user') throw new ApiError(403, 'Employee authentication required');
      validatePassword(newPassword);
      const user = await repository.getUser(context.userId);
      if (!available(user) || !await comparePassword(currentPassword, user.password_hash)) throw invalid();
      if (await comparePassword(newPassword, user.password_hash)) throw new ApiError(400, 'Choose a different password');
      if (!await repository.changePassword(user.id, user.password_hash, await hashPassword(newPassword, config.bcryptRounds))) throw invalid();
      await notify('sendPasswordChanged', user.email);
    },
    // Internal provisioning only. No public device enrollment or agent role from login input.
    async provisionDevice(actor, userId) {
      await admin(actor);
      const user = await repository.getUser(userId);
      if (!available(user)) throw new ApiError(400, 'Employee unavailable');
      const credential = opaqueToken();
      const device = await repository.createDevice({ id: randomUUID(), user_id: userId,
        created_by: actor.userId, credential_hash: tokenHash(credential) });
      return { deviceId: device.id, credential };
    },
    async loginDevice(deviceId, credential) {
      const device = await repository.getDevice(deviceId);
      const candidate = tokenHash(credential);
      if (!device?.is_active || !timingSafeEqual(Buffer.from(candidate), Buffer.from(device.credential_hash))) throw invalid();
      const user = await repository.getUser(device.user_id);
      if (!available(user) || user.must_change_password) throw invalid();
      return issue(user, device.id);
    },
    async canReadEmployee(context, employeeId) {
      if (context.role === 'A') return true;
      if (context.role === 'M') return context.userId === employeeId || repository.isManaged(context.userId, employeeId);
      return context.userId === employeeId;
    },
  };
}
