import { AssignmentConfigSchema } from '@chorly/shared';
import type { User } from '@prisma/client';

export function eligibleUsers(assignmentConfig: unknown, userMap: Map<string, User>): User[] {
  const assignment = AssignmentConfigSchema.parse(assignmentConfig);
  return assignment.assigneeIds
    .map((id) => userMap.get(id))
    .filter((u): u is User => !!u)
    .filter((u) => u.isActive)
    .filter((u) => (assignment.skipAwayUsers ? !u.isAway : true));
}

export function selectAssigneeIds(
  assignmentConfig: unknown,
  users: User[],
  lastAssignedUserId: string | null,
): { assigneeIds: string[]; nextLastAssignedUserId: string | null } {
  const assignment = AssignmentConfigSchema.parse(assignmentConfig);
  if (users.length === 0) return { assigneeIds: [], nextLastAssignedUserId: lastAssignedUserId };

  if (assignment.shared) {
    // Shared chores rotate across the selected kids; one assignee per occurrence.
    const currentIndex = users.findIndex((u) => u.id === lastAssignedUserId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % users.length : 0;
    const chosen = users[nextIndex];
    return { assigneeIds: [chosen.id], nextLastAssignedUserId: chosen.id };
  }

  if (assignment.mode === 'fixed') {
    return { assigneeIds: [users[0].id], nextLastAssignedUserId: users[0].id };
  }

  const currentIndex = users.findIndex((u) => u.id === lastAssignedUserId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % users.length : 0;
  const chosen = users[nextIndex];
  return { assigneeIds: [chosen.id], nextLastAssignedUserId: chosen.id };
}
