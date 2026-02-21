import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { AssignmentConfig, CreateChoreDefinition, UpdateChoreDefinition } from '@chorly/shared';
import { AssignmentConfigSchema, ChoreScheduleSchema } from '@chorly/shared';
import { Prisma } from '@prisma/client';

@Injectable()
export class ChoresService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.choreDefinition.findMany({
      where: { tenantId, isTemplate: false, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  templates(tenantId: string) {
    return this.prisma.choreDefinition.findMany({
      where: { tenantId, isTemplate: true, deletedAt: null },
      orderBy: { title_en: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const chore = await this.prisma.choreDefinition.findFirst({
      where: { tenantId, id, deletedAt: null },
    });
    if (!chore) throw new NotFoundException('Chore not found');
    return chore;
  }

  async create(tenantId: string, data: CreateChoreDefinition, isTemplate = false) {
    const schedule = ChoreScheduleSchema.parse(data.schedule);
    const assignment = AssignmentConfigSchema.parse(data.assignment);
    return this.prisma.choreDefinition.create({
      data: {
        tenantId,
        title_en: data.title_en,
        title_he: data.title_he,
        hasReward: data.hasReward ?? false,
        rewardAmount: data.rewardAmount ? new Prisma.Decimal(data.rewardAmount) : null,
        allowNotes: data.allowNotes ?? true,
        allowPhotoProof: data.allowPhotoProof ?? false,
        scheduleJson: schedule,
        assignmentJson: assignment,
        isTemplate,
      },
    });
  }

  async update(tenantId: string, id: string, patch: UpdateChoreDefinition) {
    const existing = await this.get(tenantId, id);
    const nextSchedule = patch.schedule ? ChoreScheduleSchema.parse(patch.schedule) : (existing.scheduleJson as object);
    const nextAssignment = patch.assignment ? AssignmentConfigSchema.parse(patch.assignment) : (existing.assignmentJson as AssignmentConfig);

    return this.prisma.choreDefinition.update({
      where: { id },
      data: {
        title_en: patch.title_en,
        title_he: patch.title_he,
        hasReward: patch.hasReward,
        rewardAmount: patch.rewardAmount ? new Prisma.Decimal(patch.rewardAmount) : patch.hasReward === false ? null : undefined,
        allowNotes: patch.allowNotes,
        allowPhotoProof: patch.allowPhotoProof,
        scheduleJson: nextSchedule,
        assignmentJson: nextAssignment,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.choreDefinition.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async cloneTemplate(tenantId: string, templateId: string) {
    const template = await this.prisma.choreDefinition.findFirst({
      where: { tenantId, id: templateId, isTemplate: true, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Template not found');

    return this.prisma.choreDefinition.create({
      data: {
        tenantId,
        title_en: template.title_en,
        title_he: template.title_he,
        hasReward: template.hasReward,
        rewardAmount: template.rewardAmount,
        allowNotes: template.allowNotes,
        allowPhotoProof: template.allowPhotoProof,
        scheduleJson: template.scheduleJson as Prisma.InputJsonValue,
        assignmentJson: template.assignmentJson as Prisma.InputJsonValue,
        isTemplate: false,
      },
    });
  }
}
