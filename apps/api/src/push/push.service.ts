import { Injectable, Logger } from '@nestjs/common';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import webpush from 'web-push';
import type { Locale } from '@prisma/client';
import { wantsNotification, type NotificationPref } from '@chorly/shared';
import { PrismaService } from '../prisma.service';

export type PushPayload = { title: string; body: string; url?: string };
// A function payload is rendered per recipient, in that user's language.
type PayloadFor = PushPayload | ((locale: Locale) => PushPayload);

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  readonly publicKey = process.env.VAPID_PUBLIC_KEY || '';
  private readonly enabled: boolean;
  private readonly fcm: Messaging | null;

  constructor(private readonly prisma: PrismaService) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT || '';
    this.fcm = serviceAccount
      ? getMessaging(initializeApp({ credential: cert(JSON.parse(Buffer.from(serviceAccount, 'base64').toString())) }))
      : null;
    const privateKey = process.env.VAPID_PRIVATE_KEY || '';
    this.enabled = !!this.publicKey && !!privateKey;
    if (this.enabled) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', this.publicKey, privateKey);
    } else {
      this.logger.warn('VAPID keys not set; push notifications disabled');
    }
  }

  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async subscribeFcm(userId: string, token: string) {
    await this.prisma.fcmToken.upsert({ where: { token }, create: { userId, token }, update: { userId } });
  }

  // `pref` is the notification type; users who turned it off are skipped. Null always sends (e.g. the test push).
  async sendToUsers(userIds: string[], pref: NotificationPref | null, payload: PayloadFor) {
    if (userIds.length === 0) return;
    await Promise.all([this.sendWebPush(userIds, pref, payload), this.sendFcm(userIds, pref, payload)]);
  }

  private async sendFcm(userIds: string[], pref: NotificationPref | null, payload: PayloadFor) {
    const fcm = this.fcm;
    if (!fcm) return;
    const devices = await this.prisma.fcmToken.findMany({
      where: { userId: { in: userIds } },
      include: { user: { select: { locale: true, notifyPrefs: true } } },
    });
    await Promise.all(
      devices
        .filter((device) => !pref || wantsNotification(device.user.notifyPrefs, pref))
        .map(async (device) => {
          const { title, body, url } = typeof payload === 'function' ? payload(device.user.locale) : payload;
          try {
            await fcm.send({
              token: device.token,
              notification: { title, body },
              data: url ? { url } : undefined,
              android: { priority: 'high' },
            });
          } catch (err: any) {
            if (err?.code === 'messaging/registration-token-not-registered') {
              await this.prisma.fcmToken.delete({ where: { id: device.id } }).catch(() => undefined);
            } else {
              this.logger.warn(`fcm failed: ${err?.code || err?.message}`);
            }
          }
        }),
    );
  }

  private async sendWebPush(userIds: string[], pref: NotificationPref | null, payload: PayloadFor) {
    if (!this.enabled) return;
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
      include: { user: { select: { locale: true, notifyPrefs: true } } },
    });
    await Promise.all(
      subs
        .filter((sub) => !pref || wantsNotification(sub.user.notifyPrefs, pref))
        .map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify(typeof payload === 'function' ? payload(sub.user.locale) : payload),
            );
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
            } else {
              this.logger.warn(`push failed: ${err?.statusCode || err?.message}`);
            }
          }
        }),
    );
  }

  async sendToParents(tenantId: string, pref: NotificationPref, payload: PayloadFor, excludeUserId?: string) {
    const parents = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, isAdmin: true, id: excludeUserId ? { not: excludeUserId } : undefined },
      select: { id: true },
    });
    await this.sendToUsers(parents.map((p) => p.id), pref, payload);
  }
}
