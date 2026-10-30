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
  RejectInstanceSchema,
  InstanceListQuerySchema,
  LocationReportSchema,
  LocationSettingsSchema,
  PlaceInputSchema,
  UpdatePlaceSchema,
  TripSchema,
  ErrandInputSchema,
  MapTagInputSchema,
  UpdateMapTagSchema,
  PokeSchema,
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
export type RejectInstanceDto = z.infer<typeof RejectInstanceSchema>;

export type LocationReport = z.infer<typeof LocationReportSchema>;
export type LocationSettings = z.infer<typeof LocationSettingsSchema>;
export type PlaceInput = z.infer<typeof PlaceInputSchema>;
export type UpdatePlace = z.infer<typeof UpdatePlaceSchema>;
export type TripInput = z.infer<typeof TripSchema>;
export type ErrandInput = z.infer<typeof ErrandInputSchema>;
export type MapTagInput = z.infer<typeof MapTagInputSchema>;
export type UpdateMapTag = z.infer<typeof UpdateMapTagSchema>;
export type PokeInput = z.infer<typeof PokeSchema>;
