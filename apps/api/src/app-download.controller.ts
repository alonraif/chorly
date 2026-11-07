import { Controller, Get, NotFoundException, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RequireUserGuard } from './common/session/require-user.guard';

const APK_DIR = process.env.APK_DIR || 'data/apk';
const APK_FILE = resolve(APK_DIR, 'chorly.apk');
// Written next to the APK by `npm run apk` in mobile/.
const VERSION_FILE = resolve(APK_DIR, 'version.json');

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

  @Get('/android/version')
  @ApiOperation({ summary: 'Version of the Android app available to download' })
  androidVersion(@Res({ passthrough: true }) res: Response) {
    if (!existsSync(APK_FILE) || !existsSync(VERSION_FILE)) throw new NotFoundException();
    let version: { versionCode?: unknown; versionName?: unknown };
    try {
      version = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
    } catch {
      throw new NotFoundException();
    }
    if (typeof version.versionCode !== 'number' || typeof version.versionName !== 'string') throw new NotFoundException();
    res.setHeader('Cache-Control', 'no-store');
    return { versionCode: version.versionCode, versionName: version.versionName };
  }
}
