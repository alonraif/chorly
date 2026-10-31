import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProofsService } from '../proofs/proofs.service';
import type { AssignmentConfig, ChoreSchedule, CreateChoreDefinition, UpdateChoreDefinition } from '@chorly/shared';
import { AssignmentConfigSchema, ChoreScheduleSchema } from '@chorly/shared';
import { Prisma, type PlaceRule } from '@prisma/client';
import { DateTime } from 'luxon';
import { RRule } from 'rrule';

const TZ = process.env.TIMEZONE || 'Asia/Jerusalem';

@Injectable()
export class ChoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proofs: ProofsService,
  ) {}

  private parseDueTime(base: DateTime, dueTime?: string) {
    if (!dueTime) return base;
    const [hourStr, minuteStr] = dueTime.split(':');
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    return base.set({ hour, minute, second: 0, millisecond: 0 });
  }

  // Instances are generated lazily: always at least a week ahead, further when a later range is viewed,
  // but never more than a year out.
  private materializeRange(through?: Date) {
    const start = DateTime.now().setZone(TZ).startOf('day');
    const minTo = start.plus({ days: 6 }).endOf('day');
    const maxTo = start.plus({ days: 366 }).endOf('day');
    let to = minTo;
    if (through) {
      const requested = DateTime.fromJSDate(through).setZone(TZ).endOf('day');
      to = requested < minTo ? minTo : requested > maxTo ? maxTo : requested;
    }
    return { from: start.toUTC().toJSDate(), to: to.toUTC().toJSDate() };
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
      // RRule works in UTC, so run it on "floating" local calendar dates (local Y-M-D stored as UTC midnight).
      // Otherwise BYDAY matches the UTC weekday, which is a day off for local midnight east of UTC.
      const floating = (d: DateTime) => new Date(Date.UTC(d.year, d.month - 1, d.day));
      const opts = RRule.parseString(schedule.rrule);
      opts.dtstart = floating(DateTime.fromJSDate(from).setZone(TZ));
      const rule = new RRule(opts);
      const days = rule.between(opts.dtstart, floating(DateTime.fromJSDate(effectiveTo).setZone(TZ)), true);
      return days
        .map((d: Date) => {
          const localDay = DateTime.fromObject(
            { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
            { zone: TZ },
          );
          return this.parseDueTime(localDay, schedule.dueTime).toUTC().toJSDate();
        })
        .filter((due) => due >= from && due <= effectiveTo);
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

    if (assignment.mode === 'together') {
      return { assigneeIds: eligibleUsers.map((u) => u.id), nextLastAssignedUserId: lastAssignedUserId };
    }

    if (assignment.shared || assignment.mode === 'round_robin') {
      const currentIndex = eligibleUsers.findIndex((u) => u.id === lastAssignedUserId);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % eligibleUsers.length : 0;
      const chosen = eligibleUsers[nextIndex];
      return { assigneeIds: [chosen.id], nextLastAssignedUserId: chosen.id };
    }

    return { assigneeIds: [eligibleUsers[0].id], nextLastAssignedUserId: eligibleUsers[0].id };
  }

  // Calendar-based repeats are fixed in advance, so they can be generated for any range being viewed.
  // "After completion" repeats depend on approvals and stay with the worker's rolling window.
  async materializeAllThrough(tenantId: string, through: Date) {
    const chores = await this.prisma.choreDefinition.findMany({
      where: { tenantId, isTemplate: false, deletedAt: null },
      select: { id: true, scheduleJson: true },
    });
    for (const chore of chores) {
      if ((chore.scheduleJson as { type?: string })?.type !== 'repeating_calendar') continue;
      await this.materializeUpcomingInstances(tenantId, chore.id, through);
    }
  }

  private async materializeUpcomingInstances(tenantId: string, choreId: string, through?: Date) {
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
        ...(assignment.skipAwayUsers ? { isAway: false } : {}),
      },
      select: { id: true },
    });
    if (users.length === 0) return;

    const { from, to } = this.materializeRange(through);
    const dueDates = [...new Set(this.dueDatesInRange(schedule, from, to).map((d) => d.getTime()))]
      .sort((a, b) => a - b)
      .map((ms) => new Date(ms));
    if (dueDates.length === 0) return;

    const existing = await this.prisma.choreInstance.findMany({
      where: { tenantId, choreId: chore.id, dueAt: { gte: dueDates[0], lte: dueDates[dueDates.length - 1] } },
      select: { dueAt: true },
    });
    const existingMs = new Set(existing.map((e) => e.dueAt.getTime()));

    let lastAssignedUserId = chore.lastAssignedUserId;
    for (const dueAt of dueDates) {
      if (existingMs.has(dueAt.getTime())) continue;

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

  // A rule needs a place and a place needs a rule; either one alone means "no place requirement".
  private async placeFields(tenantId: string, placeId: string | null | undefined, rule: PlaceRule | null | undefined) {
    if (placeId === undefined && rule === undefined) return {};
    if (!placeId || !rule) return { requiredPlaceId: null, placeRule: null };
    const place = await this.prisma.place.findFirst({ where: { id: placeId, tenantId }, select: { id: true } });
    if (!place) throw new BadRequestException('Unknown place');
    return { requiredPlaceId: placeId, placeRule: rule };
  }

  list(tenantId: string) {
    return this.prisma.choreDefinition.findMany({
      where: { tenantId, isTemplate: false, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Kids only need reward amounts for their own chores; assignees stay private (chores can include parents).
  listForKid(tenantId: string, userId: string) {
    return this.prisma.choreDefinition.findMany({
      where: { tenantId, isTemplate: false, deletedAt: null, instances: { some: { assignments: { some: { userId } } } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title_en: true, title_he: true, hasReward: true, rewardAmount: true },
    });
  }

  templates(tenantId: string) {
    return this.prisma.choreDefinition.findMany({
      where: { tenantId, isTemplate: true, deletedAt: null },
      orderBy: { title_en: 'asc' },
    });
  }

  private async getTemplate(tenantId: string, id: string) {
    const template = await this.prisma.choreDefinition.findFirst({
      where: { tenantId, id, isTemplate: true, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  // Templates never have instances, so editing/removing one touches only the definition row.
  async updateTemplate(tenantId: string, id: string, patch: UpdateChoreDefinition) {
    await this.getTemplate(tenantId, id);
    return this.prisma.choreDefinition.update({
      where: { id },
      data: {
        title_en: patch.title_en,
        title_he: patch.title_he,
        hasReward: patch.hasReward,
        rewardAmount: patch.hasReward === false
          ? null
          : patch.rewardAmount
            ? new Prisma.Decimal(patch.rewardAmount)
            : undefined,
        scheduleJson: patch.schedule ? ChoreScheduleSchema.parse(patch.schedule) : undefined,
        assignmentJson: patch.assignment ? AssignmentConfigSchema.parse(patch.assignment) : undefined,
        ...(await this.placeFields(tenantId, patch.requiredPlaceId, patch.placeRule)),
      },
    });
  }

  async removeTemplate(tenantId: string, id: string) {
    await this.getTemplate(tenantId, id);
    await this.prisma.choreDefinition.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
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
        ...(await this.placeFields(tenantId, data.requiredPlaceId, data.placeRule)),
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

    const updated = await this.prisma.choreDefinition.update({
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
        ...(await this.placeFields(tenantId, patch.requiredPlaceId, patch.placeRule)),
      },
    });
    await this.deleteUpcomingProofs(tenantId, id);
    const now = new Date();
    await this.prisma.choreInstance.deleteMany({
      where: {
        tenantId,
        choreId: id,
        dueAt: { gte: now },
        status: { not: 'approved' },
      },
    });
    await this.materializeUpcomingInstances(tenantId, id);
    return updated;
  }

  private async deleteUpcomingProofs(tenantId: string, choreId: string) {
    const instances = await this.prisma.choreInstance.findMany({
      where: { tenantId, choreId, dueAt: { gte: new Date() }, status: { not: 'approved' } },
      select: { id: true },
    });
    await this.proofs.removeForInstances(instances.map((i) => i.id));
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.deleteUpcomingProofs(tenantId, id);
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
        requiredPlaceId: template.requiredPlaceId,
        placeRule: template.placeRule,
        isTemplate: false,
      },
    });
    await this.materializeUpcomingInstances(tenantId, created.id);
    return created;
  }
}
