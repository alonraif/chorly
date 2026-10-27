export const TENANT_ID_FILTER = process.env.DEV_TENANT_ID || process.env.TENANT_ID || '';
export const TZ = process.env.TIMEZONE || 'Asia/Jerusalem';
export const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
export const GENERATE_DAYS_AHEAD = Number(process.env.GENERATE_DAYS_AHEAD || 14);
// How long before the due time the "due soon" reminder goes out.
export const DUE_SOON_MINUTES = Number(process.env.DUE_SOON_MINUTES || 30);
// Overdue chores stop being nagged about this many days after they were due.
export const OVERDUE_MAX_DAYS = Number(process.env.OVERDUE_MAX_DAYS || 3);
// "HH:MM-HH:MM" local time window with no "due soon" reminders.
export const QUIET_HOURS = process.env.QUIET_HOURS || '21:00-07:00';

export function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 1025);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || 'chorly@local.test';
  if (!host) return null;
  return {
    host,
    port,
    auth: user ? { user, pass: pass || '' } : undefined,
    from,
  };
}
