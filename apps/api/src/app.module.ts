import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';
import { ChoresModule } from './chores/chores.module';
import { InstancesModule } from './instances/instances.module';
import { SessionMiddleware } from './common/session/session.middleware';
import { AdminGuard } from './common/session/admin.guard';
import { RequireUserGuard } from './common/session/require-user.guard';
import { PrismaModule } from './prisma.module';
import { RequireTenantGuard } from './common/session/require-tenant.guard';
import { FamilyModule } from './family/family.module';
import { AuthModule } from './auth/auth.module';
import { PushModule } from './push/push.module';

@Module({
  imports: [PrismaModule, PushModule, UsersModule, ChoresModule, InstancesModule, FamilyModule, AuthModule],
  controllers: [HealthController],
  providers: [SessionMiddleware, AdminGuard, RequireUserGuard, RequireTenantGuard],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SessionMiddleware).forRoutes('*');
  }
}
