import nodemailer from 'nodemailer';
import { smtpConfig } from './config';

const cfg = smtpConfig();

const transporter = cfg
  ? nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: false,
      auth: cfg.auth,
    })
  : null;

export async function sendEmail(to: string | null | undefined, subject: string, text: string) {
  if (!to) return;
  if (!transporter || !cfg) {
    console.log('[worker:mail] SMTP not configured, skip', { to, subject });
    return;
  }
  await transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
  });
}
