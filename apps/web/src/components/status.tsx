import { isOverdue } from '../lib/format';
import { t, type MessageKey } from '../lib/i18n';
import type { Instance } from '../lib/types';
import { Icon } from './icon';

export function statusOf(instance: Pick<Instance, 'status' | 'dueAt'>) {
  if (instance.status === 'approved') return 'approved' as const;
  if (instance.status === 'done') return 'waiting' as const;
  if (isOverdue(instance.dueAt, instance.status)) return 'overdue' as const;
  return 'todo' as const;
}

const LABELS: Record<ReturnType<typeof statusOf>, { label: MessageKey; icon: 'star' | 'clock' | 'alert' | null; cls: string }> = {
  approved: { label: 'status.approved', icon: 'star', cls: 'pill-success' },
  waiting: { label: 'status.waiting', icon: 'clock', cls: 'pill-waiting' },
  overdue: { label: 'status.overdue', icon: 'alert', cls: 'pill-danger' },
  todo: { label: 'status.todo', icon: null, cls: 'pill-neutral' },
};

export function StatusPill({ instance }: { instance: Pick<Instance, 'status' | 'dueAt'> }) {
  const s = LABELS[statusOf(instance)];
  return (
    <span className={`pill ${s.cls}`}>
      {s.icon && <Icon name={s.icon} size={14} />}
      {t(s.label)}
    </span>
  );
}
