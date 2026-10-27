import { Injectable, Logger } from '@nestjs/common';
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

  constructor(private readonly prisma: PrismaService) {
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

  // `pref` is the notification type; users who turned it off are skipped. Null always sends (e.g. the test push).
  async sendToUsers(userIds: string[], pref: NotificationPref | null, payload: PayloadFor) {
    if (!this.enabled || userIds.length === 0) return;
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
