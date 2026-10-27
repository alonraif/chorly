import type { PrismaClient } from '@prisma/client';
import webpush from 'web-push';
import { sendEmail } from './email';

const vapidPublic = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || '';
const pushEnabled = !!vapidPublic && !!vapidPrivate;
if (pushEnabled) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapidPublic, vapidPrivate);
}

type Recipient = { id: string; email: string | null };
type Message = { title: string; body: string; url: string };

// Push to every registered device of the user; email too when SMTP is configured.
export async function notifyUser(prisma: PrismaClient, user: Recipient, msg: Message) {
  if (pushEnabled) {
    const subs = await prisma.pushSubscription.findMany({ where: { userId: user.id } });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(msg),
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        } else {
          console.warn('[worker:push] failed', err?.statusCode || err?.message);
        }
      }
    }
  }
  await sendEmail(user.email, msg.title, msg.body);
}
