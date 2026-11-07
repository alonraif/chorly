import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { hashPassword, verifyPassword } from '../common/auth/password';
import { hashSessionToken, newSessionToken, SESSION_COOKIE, SESSION_TTL_DAYS } from '../common/session/session-token';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Per address, and per account so that many addresses can't take turns guessing one password.
const LOGIN_MAX_FAILURES_PER_IP = 10;
const LOGIN_MAX_FAILURES_PER_ACCOUNT = 20;
// Past this many tracked keys, expired ones are swept; the map can't grow without end.
const MAX_TRACKED = 10_000;

@Injectable()
export class AuthService {
  private readonly failures = new Map<string, { count: number; firstAt: number }>();
  // Checked against when the email has no account, so both answers take as long as scrypt.
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string, ip: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const ipKey = `ip:${ip}`;
    const accountKey = `account:${normalizedEmail}`;
    this.assertNotLocked(ipKey, LOGIN_MAX_FAILURES_PER_IP);
    this.assertNotLocked(accountKey, LOGIN_MAX_FAILURES_PER_ACCOUNT);
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    const hash = user?.passwordHash || (await (this.dummyHash ??= hashPassword(newSessionToken())));
    const matches = await verifyPassword(password, hash);
    const valid = !!user && user.isActive && !!user.passwordHash && matches;
    if (!valid || !user) {
      this.recordFailure(ipKey);
      this.recordFailure(accountKey);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.failures.delete(ipKey);
    this.failures.delete(accountKey);
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

  private assertNotLocked(key: string, max: number) {
    const entry = this.failures.get(key);
    if (!entry) return;
    if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
      this.failures.delete(key);
      return;
    }
    if (entry.count >= max) {
      throw new HttpException('Too many login attempts. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(key: string) {
    const entry = this.failures.get(key);
    if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
      if (this.failures.size >= MAX_TRACKED) this.sweep();
      this.failures.set(key, { count: 1, firstAt: Date.now() });
    } else {
      entry.count += 1;
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [key, entry] of this.failures) {
      if (now - entry.firstAt > LOGIN_WINDOW_MS) this.failures.delete(key);
    }
    // Still full of live entries: drop the oldest rather than grow.
    for (const key of this.failures.keys()) {
      if (this.failures.size < MAX_TRACKED) break;
      this.failures.delete(key);
    }
  }
}
