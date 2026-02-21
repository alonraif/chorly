import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentTenant } from '../common/dev-auth/current-tenant.decorator';
import { CurrentUser } from '../common/dev-auth/current-user.decorator';
import type { RequestUser } from '../common/dev-auth/dev-auth.types';
import { AdminGuard } from '../common/dev-auth/admin.guard';
import { RequireTenantGuard } from '../common/dev-auth/require-tenant.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FamilyService } from './family.service';

const CreateFamilySchema = z.object({
  familyName: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  locale: z.enum(['en', 'he']).optional(),
});

const InviteSchema = z.object({
  email: z.string().email(),
  expiresInDays: z.number().int().positive().max(30).optional(),
});

const AcceptInviteSchema = z.object({
  token: z.string().min(10),
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  locale: z.enum(['en', 'he']).optional(),
});

@ApiTags('family')
@ApiHeader({ name: 'x-user-id', required: false })
@ApiHeader({ name: 'x-tenant-id', required: false, description: 'System admin tenant override' })
@Controller('/family')
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Post('/create')
  @ApiOperation({ summary: 'Create a new family and its first admin user (first sign-in flow)' })
  @ApiBody({ schema: { type: 'object', required: ['familyName', 'displayName'], properties: { familyName: { type: 'string' }, displayName: { type: 'string' }, email: { type: 'string' }, locale: { type: 'string', enum: ['en', 'he'] } } } })
  createFamily(@Body(new ZodValidationPipe(CreateFamilySchema)) body: any) {
    return this.family.createFamily(body);
  }

  @Get('/members')
  @UseGuards(RequireTenantGuard)
  @ApiOperation({ summary: 'List members in current family' })
  members(@CurrentTenant() tenantId: string) {
    return this.family.listMembers(tenantId);
  }

  @Get('/invites')
  @UseGuards(AdminGuard, RequireTenantGuard)
  @ApiOperation({ summary: 'List pending invites for current family' })
  invites(@CurrentTenant() tenantId: string) {
    return this.family.listInvites(tenantId);
  }

  @Post('/invites')
  @UseGuards(AdminGuard, RequireTenantGuard)
  @ApiOperation({ summary: 'Invite a user to current family (admin)' })
  @ApiBody({ schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' }, expiresInDays: { type: 'number' } } } })
  invite(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(InviteSchema)) body: any,
  ) {
    return this.family.invite(tenantId, user, body.email, body.expiresInDays);
  }

  @Post('/invites/accept')
  @ApiOperation({ summary: 'Accept invite and join family' })
  @ApiBody({ schema: { type: 'object', required: ['token', 'displayName'], properties: { token: { type: 'string' }, displayName: { type: 'string' }, email: { type: 'string' }, locale: { type: 'string', enum: ['en', 'he'] } } } })
  accept(@Body(new ZodValidationPipe(AcceptInviteSchema)) body: any) {
    return this.family.acceptInvite(body);
  }
}
