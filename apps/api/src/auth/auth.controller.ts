import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../common/session/current-user.decorator';
import type { RequestUser } from '../common/session/session.types';
import { readCookie, SESSION_COOKIE } from '../common/session/session-token';
import { AuthService } from './auth.service';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@ApiTags('auth')
@Controller('/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('/login')
  @ApiOperation({ summary: 'Login with email and password (sets session cookie)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
    },
  })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.login(body.email, body.password, req.ip || 'unknown');
    await this.auth.startSession(res, user.id);
    return this.auth.publicUser(user);
  }

  @Post('/logout')
  @ApiOperation({ summary: 'End the current session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.endSession(res, readCookie(req.headers.cookie, SESSION_COOKIE));
    return { ok: true };
  }

  @Get('/me')
  @ApiOperation({ summary: 'Current logged-in user' })
  me(@CurrentUser() user: RequestUser | undefined) {
    if (!user) throw new UnauthorizedException('Login required');
    return user;
  }

  @Get('/status')
  @ApiOperation({ summary: 'Whether first-run family setup is still needed' })
  async status() {
    return { needsSetup: await this.auth.needsSetup() };
  }
}
