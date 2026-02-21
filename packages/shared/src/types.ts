import type { z } from 'zod';
import type {
  LocaleSchema,
  FamilyRoleSchema,
  ChoreScheduleSchema,
  AssignmentModeSchema,
  AssignmentConfigSchema,
  CreateUserSchema,
  UpdateUserSchema,
  CreateChoreDefinitionSchema,
  UpdateChoreDefinitionSchema,
  MarkDoneSchema,
  UndoDoneSchema,
  ApproveInstanceSchema,
  InstanceListQuerySchema,
} from './schemas';

export type Locale = z.infer<typeof LocaleSchema>;
export type FamilyRole = z.infer<typeof FamilyRoleSchema>;
export type AssignmentMode = z.infer<typeof AssignmentModeSchema>;
export type ChoreSchedule = z.infer<typeof ChoreScheduleSchema>;
export type AssignmentConfig = z.infer<typeof AssignmentConfigSchema>;

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;

export type CreateChoreDefinition = z.infer<typeof CreateChoreDefinitionSchema>;
export type UpdateChoreDefinition = z.infer<typeof UpdateChoreDefinitionSchema>;

export type InstanceListQuery = z.infer<typeof InstanceListQuerySchema>;
export type MarkDoneDto = z.infer<typeof MarkDoneSchema>;
export type UndoDoneDto = z.infer<typeof UndoDoneSchema>;
export type ApproveInstanceDto = z.infer<typeof ApproveInstanceSchema>;
