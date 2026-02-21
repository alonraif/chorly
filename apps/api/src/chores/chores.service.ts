import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { AssignmentConfig, ChoreSchedule, CreateChoreDefinition, UpdateChoreDefinition } from '@chorly/shared';
import { AssignmentConfigSchema, ChoreScheduleSchema } from '@chorly/shared';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { RRule } from 'rrule';

const TZ = process.env.TIMEZONE || 'Asia/Jerusalem';

@Injectable()
export class ChoresService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDueTime(base: DateTime, dueTime?: string) {
    if (!dueTime) return base;
    const [hourStr, minuteStr] = dueTime.split(':');
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    return base.set({ hour, minute, second: 0, millisecond: 0 });
  }

  private nextWeekRange() {
    const start = DateTime.now().setZone(TZ).startOf('day');
    return {
      from: start.toUTC().toJSDate(),
      to: start.plus({ days: 6 }).endOf('day').toUTC().toJSDate(),
    };
  }

  private dueDatesInRange(schedule: ChoreSchedule, from: Date, to: Date): Date[] {
    if (schedule.type === 'one_time') {
      const due = DateTime.fromISO(schedule.oneTimeDueAt, { zone: 'utc' }).toJSDate();
      return due >= from && due <= to ? [due] : [];
    }

    const endsAtUtc = schedule.endsAt ? DateTime.fromISO(schedule.endsAt, { zone: 'utc' }).toJSDate() : null;
    const effectiveTo = endsAtUtc && endsAtUtc < to ? endsAtUtc : to;
    if (effectiveTo < from) return [];

    if (schedule.type === 'repeating_calendar') {
      const opts = RRule.parseString(schedule.rrule);
      opts.dtstart = DateTime.fromJSDate(from).setZone(TZ).startOf('day').toUTC().toJSDate();
      if (endsAtUtc) opts.until = endsAtUtc;
      const rule = new RRule(opts);
      return rule.between(from, effectiveTo, true).map((d: Date) => {
        const withTime = this.parseDueTime(DateTime.fromJSDate(d).setZone(TZ), schedule.dueTime);
        return withTime.toUTC().toJSDate();
      });
    }

    const dueDates: Date[] = [];
    let cursor = DateTime.now().setZone(TZ);
    while (true) {
      const candidate = this.parseDueTime(cursor.plus({ days: schedule.intervalDays }), schedule.dueTime).toUTC().toJSDate();
      if (endsAtUtc && candidate > endsAtUtc) break;
      if (candidate > to) break;
      if (candidate >= from) dueDates.push(candidate);
      cursor = DateTime.fromJSDate(candidate).setZone(TZ);
    }
    return dueDates;
  }

  private selectAssignees(
    assignment: AssignmentConfig,
    eligibleUsers: Array<{ id: string }>,
    lastAssignedUserId: string | null,
  ): { assigneeIds: string[]; nextLastAssignedUserId: string | null } {
    if (eligibleUsers.length === 0) {
      return { assigneeIds: [], nextLastAssignedUserId: lastAssignedUserId };
    }

    if (assignment.shared || assignment.mode === 'round_robin') {
      const currentIndex = eligibleUsers.findIndex((u) => u.id === lastAssignedUserId);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % eligibleUsers.length : 0;
      const chosen = eligibleUsers[nextIndex];
      return { assigneeIds: [chosen.id], nextLastAssignedUserId: chosen.id };
    }

    return { assigneeIds: [eligibleUsers[0].id], nextLastAssignedUserId: eligibleUsers[0].id };
  }

  private async materializeUpcomingInstances(tenantId: string, choreId: string) {
    const chore = await this.prisma.choreDefinition.findFirst({
      where: { id: choreId, tenantId, deletedAt: null },
      select: {
        id: true,
        assignmentJson: true,
        scheduleJson: true,
        lastAssignedUserId: true,
      },
    });
    if (!chore) return;

    const assignment = AssignmentConfigSchema.parse(chore.assignmentJson);
    const schedule = ChoreScheduleSchema.parse(chore.scheduleJson);
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        id: { in: assignment.assigneeIds },
        isActive: true,
        role: 'child',
        ...(assignment.skipAwayUsers ? { isAway: false } : {}),
      },
      select: { id: true },
    });
    if (users.length === 0) return;

    const { from, to } = this.nextWeekRange();
    const dueDates = [...new Set(this.dueDatesInRange(schedule, from, to).map((d) => d.getTime()))]
      .sort((a, b) => a - b)
      .map((ms) => new Date(ms));

    let lastAssignedUserId = chore.lastAssignedUserId;
    for (const dueAt of dueDates) {
      const existing = await this.prisma.choreInstance.findUnique({
        where: { tenantId_choreId_dueAt: { tenantId, choreId: chore.id, dueAt } },
        select: { id: true },
      });
      if (existing) continue;

      const selection = this.selectAssignees(assignment, users, lastAssignedUserId);
      if (selection.assigneeIds.length === 0) continue;

      await this.prisma.choreInstance.create({
        data: {
          tenantId,
          choreId: chore.id,
          dueAt,
          assignments: { create: selection.assigneeIds.map((userId) => ({ userId })) },
        },
      });

      if (selection.nextLastAssignedUserId !== lastAssignedUserId) {
        lastAssignedUserId = selection.nextLastAssignedUserId;
      }
    }

    if (lastAssignedUserId !== chore.lastAssignedUserId) {
      await this.prisma.choreDefinition.update({
        where: { id: chore.id },
        data: { lastAssignedUserId },
      });
    }
  }

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
    const created = await this.prisma.choreDefinition.create({
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
    if (!isTemplate) {
      await this.materializeUpcomingInstances(tenantId, created.id);
    }
    return created;
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
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.choreDefinition.update({ where: { id }, data: { deletedAt: now } });
      await tx.choreInstance.deleteMany({
        where: {
          tenantId,
          choreId: id,
          dueAt: { gte: now },
          status: { not: 'approved' },
        },
      });
    });
    return { ok: true };
  }

  async cloneTemplate(tenantId: string, templateId: string) {
    const template = await this.prisma.choreDefinition.findFirst({
      where: { tenantId, id: templateId, isTemplate: true, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Template not found');

    const created = await this.prisma.choreDefinition.create({
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
    await this.materializeUpcomingInstances(tenantId, created.id);
    return created;
  }
}
