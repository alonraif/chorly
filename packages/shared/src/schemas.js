"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateChoreSchema = exports.CreateChoreSchema = exports.AssignmentModeSchema = exports.ScheduleTypeSchema = exports.UpdateUserSchema = exports.CreateUserSchema = exports.LocaleSchema = void 0;
const zod_1 = require("zod");
exports.LocaleSchema = zod_1.z.union([zod_1.z.literal('en'), zod_1.z.literal('he')]);
exports.CreateUserSchema = zod_1.z.object({
    email: zod_1.z.string().email().optional(),
    displayName: zod_1.z.string().min(1),
    isAdmin: zod_1.z.boolean().default(false),
    locale: exports.LocaleSchema.default('he'),
});
exports.UpdateUserSchema = exports.CreateUserSchema.partial();
exports.ScheduleTypeSchema = zod_1.z.union([
    zod_1.z.literal('one_time'),
    zod_1.z.literal('repeating_calendar'),
    zod_1.z.literal('repeating_after_completion'),
]);
exports.AssignmentModeSchema = zod_1.z.union([zod_1.z.literal('fixed'), zod_1.z.literal('round_robin')]);
exports.CreateChoreSchema = zod_1.z.object({
    title_en: zod_1.z.string().min(1),
    title_he: zod_1.z.string().min(1),
    description_en: zod_1.z.string().optional(),
    description_he: zod_1.z.string().optional(),
    hasReward: zod_1.z.boolean().default(false),
    rewardAmount: zod_1.z.string().optional(),
    allowNotes: zod_1.z.boolean().default(true),
    allowPhotoProof: zod_1.z.boolean().default(false),
    schedule: zod_1.z.object({
        type: exports.ScheduleTypeSchema,
        rrule: zod_1.z.string().optional(),
        oneTimeDueAt: zod_1.z.string().optional(),
        intervalDays: zod_1.z.number().int().positive().optional(),
        dueTime: zod_1.z.string().optional(),
        gracePeriodMinutes: zod_1.z.number().int().min(0).optional(),
    }),
    assignment: zod_1.z.object({
        mode: exports.AssignmentModeSchema,
        shared: zod_1.z.boolean().default(false),
        skipAwayUsers: zod_1.z.boolean().default(true),
        assigneeIds: zod_1.z.array(zod_1.z.string().min(1)).min(1),
    }),
});
exports.UpdateChoreSchema = exports.CreateChoreSchema.partial();
