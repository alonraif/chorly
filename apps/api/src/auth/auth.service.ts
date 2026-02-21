import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { verifyPassword } from '../common/auth/password';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      id: user.id,
      tenantId: user.tenantId,
      displayName: user.displayName,
      email: user.email,
      locale: user.locale,
      role: user.role,
      isAdmin: user.isAdmin,
      isSystemAdmin: user.isSystemAdmin,
    };
  }
}
