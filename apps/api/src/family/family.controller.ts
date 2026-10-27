import { Body, Controller, ForbiddenException, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentTenant } from '../common/session/current-tenant.decorator';
import { RequireTenantGuard } from '../common/session/require-tenant.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from '../auth/auth.service';
import { FamilyService } from './family.service';

const CreateFamilySchema = z.object({
  familyName: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  locale: z.enum(['en', 'he']).optional(),
});

@ApiTags('family')
@Controller('/family')
export class FamilyController {
  constructor(
    private readonly family: FamilyService,
    private readonly auth: AuthService,
  ) {}

  @Post('/create')
  @ApiOperation({ summary: 'First-run setup: create the family and the first parent. Disabled once any user exists.' })
  @ApiBody({ schema: { type: 'object', required: ['familyName', 'displayName', 'email', 'password'], properties: { familyName: { type: 'string' }, displayName: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' }, locale: { type: 'string', enum: ['en', 'he'] } } } })
  async createFamily(@Body(new ZodValidationPipe(CreateFamilySchema)) body: any, @Res({ passthrough: true }) res: Response) {
    if (!(await this.auth.needsSetup())) {
      throw new ForbiddenException('Family already set up. Ask a parent to add you.');
    }
    const { tenant, admin } = await this.family.createFamily(body);
    await this.auth.startSession(res, admin.id);
    return { tenant, admin: this.auth.publicUser(admin) };
  }

  @Get('/current')
  @UseGuards(RequireTenantGuard)
  @ApiOperation({ summary: 'Get family details' })
  current(@CurrentTenant() tenantId: string) {
    return this.family.current(tenantId);
  }
}
