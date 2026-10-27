import { isOverdue } from '../lib/format';
import type { Instance } from '../lib/types';
import { Icon } from './icon';

export function statusOf(instance: Pick<Instance, 'status' | 'dueAt'>) {
  if (instance.status === 'approved') return 'approved' as const;
  if (instance.status === 'done') return 'waiting' as const;
  if (isOverdue(instance.dueAt, instance.status)) return 'overdue' as const;
  return 'todo' as const;
}

const LABELS = {
  approved: { label: 'Approved', icon: 'star' as const, cls: 'pill-success' },
  waiting: { label: 'Needs approval', icon: 'clock' as const, cls: 'pill-waiting' },
  overdue: { label: 'Overdue', icon: 'alert' as const, cls: 'pill-danger' },
  todo: { label: 'To do', icon: null, cls: 'pill-neutral' },
};

export function StatusPill({ instance }: { instance: Pick<Instance, 'status' | 'dueAt'> }) {
  const s = LABELS[statusOf(instance)];
  return (
    <span className={`pill ${s.cls}`}>
      {s.icon && <Icon name={s.icon} size={14} />}
      {s.label}
    </span>
  );
}
