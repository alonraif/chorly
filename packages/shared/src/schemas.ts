import { z } from 'zod';

export const LocaleSchema = z.union([z.literal('en'), z.literal('he')]);
export const FamilyRoleSchema = z.union([z.literal('parent'), z.literal('child')]);

export const CreateUserSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1),
  password: z.string().min(8).optional(),
  role: FamilyRoleSchema,
  locale: LocaleSchema.default('he'),
  isAway: z.boolean().default(false),
});

export const UpdateUserSchema = CreateUserSchema.partial();

// Notification types a member can turn off. Missing keys mean "on".
export const NOTIFICATION_PREFS = [
  'readyForApproval',
  'approved',
  'rejected',
  'morning',
  'dueSoon',
  'overdue',
  'parentDigest',
  'weekly',
  'placeAlerts',
  'arrivalNudge',
  'errands',
  'pokes',
  'deviceAlerts',
  'placeRecap',
] as const;
export type NotificationPref = (typeof NOTIFICATION_PREFS)[number];
export const NotificationPrefsSchema = z
  .object(Object.fromEntries(NOTIFICATION_PREFS.map((k) => [k, z.boolean()])) as Record<NotificationPref, z.ZodBoolean>)
  .partial()
  .strict();
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export function wantsNotification(prefs: unknown, pref: NotificationPref) {
  return (prefs as NotificationPrefs | null | undefined)?.[pref] !== false;
}

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

// 'at_place': can only be marked done while at the place. 'visited': a visit that day is the proof.
export const PlaceRuleSchema = z.union([z.literal('at_place'), z.literal('visited')]);

export const ChoreDefinitionBaseSchema = z.object({
  title_en: z.string().min(1),
  title_he: z.string().min(1),
  hasReward: z.boolean().default(false),
  rewardAmount: z.string().optional(),
  allowNotes: z.boolean().default(true),
  allowPhotoProof: z.boolean().default(false),
  schedule: ChoreScheduleSchema,
  assignment: AssignmentConfigSchema,
  requiredPlaceId: z.string().min(1).nullable().optional(),
  placeRule: PlaceRuleSchema.nullable().optional(),
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
  photoKeys: z.array(z.string().min(1)).max(1).optional(),
});

export const UndoDoneSchema = z.object({});

export const ApproveInstanceSchema = z.object({
  rewardAmount: z.string().optional(),
});

export const RejectInstanceSchema = z.object({
  reason: z.string().trim().min(1).max(300).optional(),
});

export const LocationReportSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullish(),
  battery: z.number().int().min(0).max(100).nullish(),
  charging: z.boolean().nullish(),
  // Metres per second; some devices report a negative number when they don't know.
  speed: z.number().nullish(),
});

export const SharingModeSchema = z.union([z.literal('exact'), z.literal('blurred'), z.literal('paused')]);

export const LocationSettingsSchema = z
  .object({
    mode: SharingModeSchema,
    // Minutes of sharing from now; null means until the member stops it.
    durationMinutes: z.number().int().min(1).max(60 * 24 * 7).nullable(),
    recap: z.boolean(),
  })
  .partial()
  .strict();

export const PlaceKindSchema = z.union([
  z.literal('home'),
  z.literal('school'),
  z.literal('work'),
  z.literal('fun'),
  z.literal('other'),
]);

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const PlaceInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: PlaceKindSchema.default('other'),
  note: z.string().trim().max(200).nullish(),
  lat,
  lng,
  radiusM: z.number().int().min(50).max(1000).default(150),
  // Paid to a child once a day when they arrive.
  rewardAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullish(),
});
export const UpdatePlaceSchema = PlaceInputSchema.partial();

export const GeocodeSchema = z.object({
  query: z.string().trim().min(2).max(200),
  language: z.string().max(10).optional(),
  // Ranks results around here, so "Herzl 12" means the one in the family's own town.
  near: z.object({ lat, lng }).optional(),
});

export const TripSchema = z.object({
  placeId: z.string().min(1),
  mode: z.union([z.literal('walk'), z.literal('drive')]),
});

export const ErrandInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  note: z.string().trim().max(200).nullish(),
  lat,
  lng,
});

export const MapTagInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8),
  lat,
  lng,
});
export const UpdateMapTagSchema = MapTagInputSchema.partial();

export const POKE_KINDS = ['wave', 'comeHome', 'dinner', 'onMyWay', 'thinking'] as const;
export const PokeSchema = z.object({
  userId: z.string().min(1),
  kind: z.enum(POKE_KINDS),
});
