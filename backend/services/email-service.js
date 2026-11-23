import nodemailer from 'nodemailer';
import { ApiError } from '../utils/api-error.js';

// SMTP transport is reusable and provider-neutral; Resend values live in .env.
export function createEmailService({ env = process.env, transportFactory = nodemailer.createTransport } = {}) {
  const port = Number(env.SMTP_PORT || 465);
  const secureValue = env.SMTP_SECURE || 'true';
  const configured = Boolean(env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASS && env.SMTP_FROM?.trim()
    && Number.isInteger(port) && port > 0 && port <= 65535 && ['true', 'false'].includes(secureValue));
  let resetUrl;
  try {
    resetUrl = new URL(env.PASSWORD_RESET_URL);
    if (resetUrl.protocol !== 'https:' || resetUrl.username || resetUrl.password) resetUrl = null;
  } catch { resetUrl = null; }
  const transport = configured ? transportFactory({ host: env.SMTP_HOST.trim(), port,
    secure: secureValue === 'true', requireTLS: true, auth: { user: env.SMTP_USER.trim(), pass: env.SMTP_PASS },
    logger: false, debug: false, connectionTimeout: 10000, socketTimeout: 15000 }) : null;

  function assertReady() {
    if (!transport) throw new ApiError(503, 'Email delivery is not configured');
  }
  function assertResetReady() {
    assertReady();
    if (!resetUrl) throw new ApiError(503, 'Password recovery URL is not configured');
  }
  async function send({ to, subject, text }) {
    assertReady();
    try {
      await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
    } catch { throw new ApiError(503, 'Email delivery unavailable'); }
  }
  return {
    assertResetReady,
    async sendPasswordReset(email, token) {
      assertResetReady();
      const link = new URL(resetUrl);
      // The frontend reads the fragment and POSTs it; no token in HTTP access logs.
      link.hash = new URLSearchParams({ token }).toString();
      await send({ to: email, subject: 'Reset your WorkPulse password',
        text: `Use this one-time, time-limited link to reset your WorkPulse password:\n${link}\nIf you did not request it, ignore this email.` });
    },
    sendAccountCreated(email) {
      return send({ to: email, subject: 'Your WorkPulse account',
        text: 'Your WorkPulse account has been created. Contact your administrator for access instructions. Tracking requires the applicable authorization and consent.' });
    },
    sendPasswordChanged(email) {
      return send({ to: email, subject: 'Your WorkPulse password was changed',
        text: 'Your WorkPulse password was changed and existing sessions were signed out. If you did not make this change, contact your administrator immediately.' });
    },
  };
}
