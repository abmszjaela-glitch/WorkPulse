import { randomUUID, randomBytes } from 'node:crypto';
import { validatePassword, hashPassword } from './passwords.js';

export function createEmployeeService({ repository, config, mailer }) {
  async function notify(method, email) {
    try { await mailer[method](email); } catch { console.error('Account notification delivery unavailable'); }
  }
  return {
    list: (actor, options) => repository.employees(actor, options),
    summary: (actor) => repository.employeeSummary(actor),
    async get(actor, id) { return (await repository.employees(actor, { id })).items[0]; },
    async create(actor, { password, temporary = true, role = 'E', ...data }) {
      validatePassword(password);
      const result = await repository.employeeWrite(actor, 'create', randomUUID(), { ...data, role, temporary,
        passwordHash: await hashPassword(password, config.bcryptRounds),
        temporaryExpiresAt: temporary ? new Date(Date.now() + config.temporarySeconds * 1000).toISOString() : null });
      await notify('sendAccountCreated', result.email); return result;
    },
    write: (actor, action, id, data) => repository.employeeWrite(actor, action, id, data),
    async resetPassword(actor, id) {
      const password = randomBytes(24).toString('base64url') + 'aA1!';
      const expiresAt = new Date(Date.now() + config.temporarySeconds * 1000).toISOString();
      const result = await repository.employeeWrite(actor, 'reset-password', id, {
        passwordHash: await hashPassword(password, config.bcryptRounds), temporaryExpiresAt: expiresAt });
      await notify('sendPasswordChanged', result.email);
      // Returned once to the authorized Admin, never logged, saved in plaintext or emailed.
      return { temporaryPassword: password, expiresAt, mustChangePassword: true };
    },
  };
}
