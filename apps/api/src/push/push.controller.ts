import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../common/session/current-user.decorator';
import { RequireUserGuard } from '../common/session/require-user.guard';
import type { RequestUser } from '../common/session/session.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PushService } from './push.service';

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

const UnsubscribeSchema = z.object({ endpoint: z.string().url() });

@ApiTags('push')
@Controller('/push')
@UseGuards(RequireUserGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('/public-key')
  @ApiOperation({ summary: 'VAPID public key for PushManager.subscribe' })
  publicKey() {
    return { publicKey: this.push.publicKey };
  }

  @Post('/subscribe')
  @ApiOperation({ summary: 'Register this device for push notifications' })
  async subscribe(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(SubscribeSchema)) body: any) {
    await this.push.subscribe(user.id, body);
    return { ok: true };
  }

  @Post('/unsubscribe')
  @ApiOperation({ summary: 'Remove this device from push notifications' })
  async unsubscribe(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(UnsubscribeSchema)) body: any) {
    await this.push.unsubscribe(user.id, body.endpoint);
    return { ok: true };
  }

  @Post('/test')
  @ApiOperation({ summary: 'Send a test notification to my devices' })
  async test(@CurrentUser() user: RequestUser) {
    await this.push.sendToUsers([user.id], { title: 'Chorly', body: `Notifications work, ${user.displayName}!`, url: '/' });
    return { ok: true };
  }
}
