import { z } from 'zod';

export const LocaleSchema = z.union([z.literal('en'), z.literal('he')]);
export const FamilyRoleSchema = z.union([z.literal('parent'), z.literal('child')]);

export const CreateUserSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1),
  password: z.string().min(8).optional(),
  role: FamilyRoleSchema,
  isAdmin: z.boolean().default(false),
  locale: LocaleSchema.default('he'),
  isAway: z.boolean().default(false),
});

export const UpdateUserSchema = CreateUserSchema.partial();

export const OneTimeScheduleSchema = z.object({
  type: z.literal('one_time'),
  oneTimeDueAt: z.string().datetime(),
  gracePeriodMinutes: z.number().int().min(0).default(60),
});

export const RepeatingCalendarScheduleSchema = z.object({
  type: z.literal('repeating_calendar'),
  rrule: z.string().min(1),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endsAt: z.string().datetime().optional(),
  gracePeriodMinutes: z.number().int().min(0).default(60),
});

export const RepeatingAfterCompletionScheduleSchema = z.object({
  type: z.literal('repeating_after_completion'),
  intervalDays: z.number().int().positive(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endsAt: z.string().datetime().optional(),
  gracePeriodMinutes: z.number().int().min(0).default(60),
});

export const ChoreScheduleSchema = z.discriminatedUnion('type', [
  OneTimeScheduleSchema,
  RepeatingCalendarScheduleSchema,
  RepeatingAfterCompletionScheduleSchema,
]);

export const AssignmentModeSchema = z.union([z.literal('fixed'), z.literal('round_robin')]);

export const AssignmentConfigSchema = z.object({
  mode: AssignmentModeSchema,
  shared: z.boolean().default(false),
  skipAwayUsers: z.boolean().default(true),
  assigneeIds: z.array(z.string().min(1)).min(1),
});

export const ChoreDefinitionBaseSchema = z.object({
  title_en: z.string().min(1),
  title_he: z.string().min(1),
  hasReward: z.boolean().default(false),
  rewardAmount: z.string().optional(),
  allowNotes: z.boolean().default(true),
  allowPhotoProof: z.boolean().default(false),
  schedule: ChoreScheduleSchema,
  assignment: AssignmentConfigSchema,
});

export const CreateChoreDefinitionSchema = ChoreDefinitionBaseSchema;
export const UpdateChoreDefinitionSchema = ChoreDefinitionBaseSchema.partial();

export const InstanceListQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  userId: z.string().optional(),
});

export const MarkDoneSchema = z.object({
  note: z.string().trim().min(1).optional(),
  photoKeys: z.array(z.string().min(1)).optional(),
});

export const UndoDoneSchema = z.object({});

export const ApproveInstanceSchema = z.object({
  rewardAmount: z.string().optional(),
});
