import type { User } from '@prisma/client';

export type RequestUser = Pick<
  User,
  'id' | 'tenantId' | 'email' | 'displayName' | 'role' | 'isAdmin' | 'locale' | 'isAway' | 'isActive' | 'notifyPrefs'
>;

export type AuthenticatedRequest = {
  user?: RequestUser;
  tenantId?: string;
  headers: Record<string, string | string[] | undefined>;
};
