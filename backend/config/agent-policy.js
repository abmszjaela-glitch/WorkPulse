import './environment.js';

export function loadAgentPolicy() {
  const positive = (key, fallback, max) => {
    const value = Number(process.env[key] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const zone = process.env.AGENT_TIMEZONE || 'Asia/Colombo';
  new Intl.DateTimeFormat('en', { timeZone: zone });
  const start = process.env.AGENT_WORK_START || '09:00', end = process.env.AGENT_WORK_END || '17:30';
  if (![start,end].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) || start === end) throw new Error('Invalid agent working hours');
  const days = (process.env.AGENT_WORK_DAYS || '1,2,3,4,5').split(',').map(Number);
  if (days.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(days).size !== days.length) throw new Error('Invalid AGENT_WORK_DAYS');
  return Object.freeze({ idleThreshold: positive('AGENT_IDLE_THRESHOLD',300,86400),
    trackingInterval: positive('AGENT_TRACKING_INTERVAL',60,3600), workingHours: { timezone: zone, start, end, days, dayNumbering: 'ISO-8601 Monday=1' },
    manualStopOverridesSchedule: true, requireConsent: true });
}
