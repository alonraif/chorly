export const TENANT_ID_FILTER = process.env.DEV_TENANT_ID || process.env.TENANT_ID || '';
export const TZ = process.env.TIMEZONE || 'Asia/Jerusalem';
export const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
export const GENERATE_DAYS_AHEAD = Number(process.env.GENERATE_DAYS_AHEAD || 14);

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
