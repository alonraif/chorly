import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestUser } from './dev-auth.types';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser | undefined => {
  const req = ctx.switchToHttp().getRequest();
  return req.user as RequestUser | undefined;
});
