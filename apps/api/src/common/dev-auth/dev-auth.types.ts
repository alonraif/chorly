import type { User } from '@prisma/client';

export type RequestUser = Pick<
  User,
  'id' | 'tenantId' | 'email' | 'displayName' | 'isAdmin' | 'isSystemAdmin' | 'locale' | 'isAway' | 'isActive'
>;

export type AuthenticatedRequest = {
  user?: RequestUser;
  tenantId?: string;
  headers: Record<string, string | string[] | undefined>;
};
