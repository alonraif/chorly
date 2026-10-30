import type { PrismaClient } from '@prisma/client';
import { wantsNotification, type NotificationPref } from '@chorly/shared';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import webpush from 'web-push';
import { sendEmail } from './email';

const vapidPublic = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || '';
const pushEnabled = !!vapidPublic && !!vapidPrivate;
if (pushEnabled) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapidPublic, vapidPrivate);
}

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT || '';
const fcm = serviceAccount
  ? getMessaging(initializeApp({ credential: cert(JSON.parse(Buffer.from(serviceAccount, 'base64').toString())) }))
  : null;

type Recipient = { id: string; email: string | null; notifyPrefs: unknown };
type Message = { title: string; body: string; url: string };

// Push to every registered device of the user; email too when SMTP is configured.
// Nothing is sent when the user turned this notification type off.
export async function notifyUser(prisma: PrismaClient, user: Recipient, pref: NotificationPref, msg: Message) {
  if (!wantsNotification(user.notifyPrefs, pref)) return;
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
  if (fcm) {
    const devices = await prisma.fcmToken.findMany({ where: { userId: user.id } });
    for (const device of devices) {
      try {
        await fcm.send({
          token: device.token,
          notification: { title: msg.title, body: msg.body },
          data: { url: msg.url },
          android: { priority: 'high' },
        });
      } catch (err: any) {
        if (err?.code === 'messaging/registration-token-not-registered') {
          await prisma.fcmToken.delete({ where: { id: device.id } }).catch(() => undefined);
        } else {
          console.warn('[worker:fcm] failed', err?.code || err?.message);
        }
      }
    }
  }
  await sendEmail(user.email, msg.title, msg.body);
}
