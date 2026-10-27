import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { verifyPassword } from '../common/auth/password';
import { hashSessionToken, newSessionToken, SESSION_COOKIE, SESSION_TTL_DAYS } from '../common/session/session-token';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

@Injectable()
export class AuthService {
  private readonly failures = new Map<string, { count: number; firstAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string, ip: string) {
    this.assertNotLocked(ip);
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    const valid = !!user && user.isActive && !!user.passwordHash && (await verifyPassword(password, user.passwordHash));
    if (!valid || !user) {
      this.recordFailure(ip);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.failures.delete(ip);
    return user;
  }

  async startSession(res: Response, userId: string) {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({ data: { tokenHash: hashSessionToken(token), userId, expiresAt } });
    await this.prisma.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  async endSession(res: Response, token: string | undefined) {
    if (token) await this.prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  async needsSetup() {
    return (await this.prisma.user.count()) === 0;
  }

  publicUser(user: { id: string; tenantId: string; displayName: string; email: string | null; locale: string; role: string; isAdmin: boolean }) {
    return {
      id: user.id,
      tenantId: user.tenantId,
      displayName: user.displayName,
      email: user.email,
      locale: user.locale,
      role: user.role,
      isAdmin: user.isAdmin,
    };
  }

  private assertNotLocked(ip: string) {
    const entry = this.failures.get(ip);
    if (!entry) return;
    if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
      this.failures.delete(ip);
      return;
    }
    if (entry.count >= LOGIN_MAX_FAILURES) {
      throw new HttpException('Too many login attempts. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(ip: string) {
    const entry = this.failures.get(ip);
    if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
      this.failures.set(ip, { count: 1, firstAt: Date.now() });
    } else {
      entry.count += 1;
    }
  }
}
