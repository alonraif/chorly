import type { InstanceStatus, ScheduleJson } from './format';

export type Instance = {
  id: string;
  choreId: string;
  dueAt: string;
  status: InstanceStatus;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rewardAmount: string | null;
  chore: { title_en: string; title_he: string; hasReward: boolean };
  proofs: Array<{ userId: string; key: string; isVideo: boolean }>;
  assignments: Array<{ userId: string; displayName: string }>;
  doneByUserId: Record<string, { doneAt: string; undoneAt: string | null }>;
};

export type AssignmentJson = {
  mode: 'fixed' | 'round_robin';
  shared: boolean;
  skipAwayUsers: boolean;
  assigneeIds: string[];
};

export type Chore = {
  id: string;
  title_en: string;
  title_he: string;
  hasReward: boolean;
  rewardAmount: string | null;
  scheduleJson: ScheduleJson;
  assignmentJson: AssignmentJson;
  isTemplate?: boolean;
};

export type Earnings = {
  userId: string;
  currencyCode: string;
  earnedTotal: string;
  paidOutTotal: string;
  dueAmount: string;
  earnEntries: Array<{
    id: string;
    amount: string;
    createdAt: string;
    instanceId: string | null;
    choreTitleEn: string | null;
    choreTitleHe: string | null;
    dueAt: string | null;
  }>;
  payoutEntries: Array<{ id: string; amount: string; createdAt: string }>;
};

// A parent's own chore skips Approvals, so there's nobody to show proof to.
export function approvesOwnChore(instance: Instance, me: { id: string; isAdmin: boolean }) {
  return me.isAdmin && instance.assignments.length === 1 && instance.assignments[0].userId === me.id;
}

export function activeDoneAt(instance: Instance) {
  const entries = Object.values(instance.doneByUserId).filter((d) => !d.undoneAt);
  return entries.sort((a, b) => b.doneAt.localeCompare(a.doneAt))[0]?.doneAt ?? null;
}

export function rangeQuery(from: string, to: string, userId?: string) {
  const base = `/instances?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return userId ? `${base}&userId=${encodeURIComponent(userId)}` : base;
}
