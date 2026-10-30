import { Controller, Get, NotFoundException, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RequireUserGuard } from './common/session/require-user.guard';

const APK_FILE = resolve(process.env.APK_DIR || 'data/apk', 'chorly.apk');

@ApiTags('app')
@Controller('/app')
@UseGuards(RequireUserGuard)
export class AppDownloadController {
  @Get('/android')
  @ApiOperation({ summary: 'Download the Android app' })
  android(@Res() res: Response) {
    if (!existsSync(APK_FILE)) throw new NotFoundException();
    res.download(APK_FILE, 'chorly.apk', {
      cacheControl: false,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/vnd.android.package-archive' },
    });
  }
}
