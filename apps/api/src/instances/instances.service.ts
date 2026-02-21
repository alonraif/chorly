import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type InstanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AssignmentConfigSchema, type ApproveInstanceDto, type MarkDoneDto } from '@chorly/shared';
import type { RequestUser } from '../common/dev-auth/dev-auth.types';

function activeDoneUserIds(instance: { completions: Array<{ userId: string; undoneAt: Date | null }> }) {
  return new Set(instance.completions.filter((c) => !c.undoneAt).map((c) => c.userId));
}

function instanceStatusFromCompletion(
  assignmentConfig: unknown,
  assignedIds: string[],
  completedUserIds: Set<string>,
): InstanceStatus {
  const assignment = AssignmentConfigSchema.parse(assignmentConfig);
  if (assignment.shared) {
    return assignedIds.some((id) => completedUserIds.has(id)) ? 'done' : 'assigned';
  }
  const primary = assignedIds[0];
  if (!primary) return 'assigned';
  return completedUserIds.has(primary) ? 'done' : 'assigned';
}

@Injectable()
export class InstancesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, from: Date, to: Date, userId?: string) {
    const instances = await this.prisma.choreInstance.findMany({
      where: {
        tenantId,
        dueAt: { gte: from, lte: to },
        ...(userId ? { assignments: { some: { userId } } } : {}),
      },
      include: {
        chore: true,
        assignments: { include: { user: true } },
        completions: true,
      },
      orderBy: { dueAt: 'asc' },
    });

    return instances.map((instance) => {
      const doneByUserId: Record<string, { doneAt: string; undoneAt: string | null }> = {};
      for (const completion of instance.completions) {
        doneByUserId[completion.userId] = {
          doneAt: completion.doneAt.toISOString(),
          undoneAt: completion.undoneAt ? completion.undoneAt.toISOString() : null,
        };
      }

      return {
        id: instance.id,
        choreId: instance.choreId,
        chore: {
          title_en: instance.chore.title_en,
          title_he: instance.chore.title_he,
          hasReward: instance.chore.hasReward,
        },
        dueAt: instance.dueAt.toISOString(),
        status: instance.status,
        approvedAt: instance.approvedAt ? instance.approvedAt.toISOString() : null,
        rewardAmount: instance.rewardAmount?.toString() ?? null,
        assignments: instance.assignments.map((a) => ({
          userId: a.userId,
          displayName: a.user.displayName,
          locale: a.user.locale,
        })),
        doneByUserId,
      };
    });
  }

  private async getInstanceOrThrow(tenantId: string, id: string) {
    const instance = await this.prisma.choreInstance.findFirst({
      where: { tenantId, id },
      include: {
        chore: true,
        assignments: true,
        completions: true,
      },
    });
    if (!instance) throw new NotFoundException('Instance not found');
    return instance;
  }

  async markDone(tenantId: string, instanceId: string, actor: RequestUser, body: MarkDoneDto) {
    const instance = await this.getInstanceOrThrow(tenantId, instanceId);
    if (!instance.assignments.some((a) => a.userId === actor.id)) {
      throw new ForbiddenException('User is not assigned to this instance');
    }

    await this.prisma.choreCompletion.upsert({
      where: { instanceId_userId: { instanceId, userId: actor.id } },
      create: { instanceId, userId: actor.id },
      update: { doneAt: new Date(), undoneAt: null },
    });

    const notesObj = (instance.notes as Record<string, string> | null) ?? {};
    const photoObj = (instance.photoKeys as Record<string, string[]> | null) ?? {};
    if (body.note !== undefined) notesObj[actor.id] = body.note;
    if (body.photoKeys !== undefined) photoObj[actor.id] = body.photoKeys;

    const refreshed = await this.getInstanceOrThrow(tenantId, instanceId);
    const status = instanceStatusFromCompletion(
      refreshed.chore.assignmentJson,
      refreshed.assignments.map((a) => a.userId),
      activeDoneUserIds(refreshed),
    );

    return this.prisma.choreInstance.update({
      where: { id: instanceId },
      data: {
        status,
        notes: notesObj,
        photoKeys: photoObj,
      },
    });
  }

  async undo(tenantId: string, instanceId: string, actor: RequestUser) {
    const instance = await this.getInstanceOrThrow(tenantId, instanceId);
    if (!instance.assignments.some((a) => a.userId === actor.id)) {
      throw new ForbiddenException('User is not assigned to this instance');
    }

    const completion = await this.prisma.choreCompletion.findUnique({
      where: { instanceId_userId: { instanceId, userId: actor.id } },
    });

    if (completion && !completion.undoneAt) {
      await this.prisma.choreCompletion.update({
        where: { id: completion.id },
        data: { undoneAt: new Date() },
      });
    }

    const refreshed = await this.getInstanceOrThrow(tenantId, instanceId);
    const status = instanceStatusFromCompletion(
      refreshed.chore.assignmentJson,
      refreshed.assignments.map((a) => a.userId),
      activeDoneUserIds(refreshed),
    );

    return this.prisma.choreInstance.update({ where: { id: instanceId }, data: { status } });
  }

  async approve(tenantId: string, instanceId: string, actor: RequestUser, body: ApproveInstanceDto) {
    const instance = await this.getInstanceOrThrow(tenantId, instanceId);
    if (!actor.isAdmin && !actor.isSystemAdmin) throw new ForbiddenException('Admin is required to approve');
    if (instance.approvedAt) throw new BadRequestException('Instance already approved');
    if (instance.status !== 'done') throw new BadRequestException('Only done instances can be approved');

    const assignment = AssignmentConfigSchema.parse(instance.chore.assignmentJson);
    const assignedIds = instance.assignments.map((a) => a.userId);
    const doneSet = activeDoneUserIds(instance);

    let creditedUsers: string[] = [];
    if (assignment.shared) {
      creditedUsers = assignedIds.filter((id) => doneSet.has(id));
    } else {
      const primary = assignedIds[0];
      if (primary && doneSet.has(primary)) {
        creditedUsers = [primary];
      }
    }

    const hasReward = instance.chore.hasReward;
    const rewardAmountRaw = body.rewardAmount ?? instance.chore.rewardAmount?.toString();
    if (hasReward && !rewardAmountRaw) {
      throw new BadRequestException('rewardAmount is required for reward chores');
    }

    const rewardAmountDecimal = hasReward && rewardAmountRaw ? new Prisma.Decimal(rewardAmountRaw) : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.choreInstance.update({
        where: { id: instanceId },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          approvedByUserId: actor.id,
          rewardAmount: rewardAmountDecimal,
        },
      });

      if (hasReward && rewardAmountDecimal && creditedUsers.length > 0) {
        await tx.moneyLedger.createMany({
          data: creditedUsers.map((userId) => ({
            tenantId,
            userId,
            type: 'earn',
            amount: rewardAmountDecimal,
            instanceId,
          })),
        });
      }

      return updated;
    });

    return result;
  }

  async remove(tenantId: string, instanceId: string) {
    await this.getInstanceOrThrow(tenantId, instanceId);
    await this.prisma.choreInstance.delete({ where: { id: instanceId } });
    return { ok: true };
  }
}
