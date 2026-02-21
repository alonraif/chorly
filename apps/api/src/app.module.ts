import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';
import { ChoresModule } from './chores/chores.module';
import { InstancesModule } from './instances/instances.module';
import { DevAuthMiddleware } from './common/dev-auth/dev-auth.middleware';
import { AdminGuard } from './common/dev-auth/admin.guard';
import { RequireUserGuard } from './common/dev-auth/require-user.guard';
import { PrismaModule } from './prisma.module';
import { RequireTenantGuard } from './common/dev-auth/require-tenant.guard';
import { SystemAdminGuard } from './common/dev-auth/system-admin.guard';
import { FamilyModule } from './family/family.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [PrismaModule, UsersModule, ChoresModule, InstancesModule, FamilyModule, SystemModule],
  controllers: [HealthController],
  providers: [DevAuthMiddleware, AdminGuard, RequireUserGuard, RequireTenantGuard, SystemAdminGuard],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DevAuthMiddleware).forRoutes('*');
  }
}
