'use client';

import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { choreTitle, firstName, friendlyDue, isOverdue, money, relativeTime, TZ } from '../lib/format';
import { useSession } from '../lib/session';
import { activeDoneAt, type Instance } from '../lib/types';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { StatusPill } from './status';
import { errorMessage, Sheet, useUi } from './ui';

export function InstanceSheet({
  instance,
  onClose,
  onChanged,
  onEditSeries,
  rewardFor,
}: {
  instance: Instance | null;
  onClose: () => void;
  onChanged: () => void;
  onEditSeries: (choreId: string) => void;
  rewardFor?: (choreId: string) => string | null;
}) {
  const { kids, currency, refreshApprovals } = useSession();
  const { toast, confirm } = useUi();
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [dueLocal, setDueLocal] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!instance) return;
    setMode('view');
    setError('');
    setDueLocal(DateTime.fromISO(instance.dueAt).setZone(TZ).toFormat("yyyy-LL-dd'T'HH:mm"));
    setAssignee(instance.assignments[0]?.userId || '');
  }, [instance]);

  if (!instance) return null;
  const title = choreTitle(instance.chore);
  const doneAt = activeDoneAt(instance);
  const reward = instance.rewardAmount || rewardFor?.(instance.choreId) || null;
  const editable = instance.status !== 'approved';

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      toast(success);
      onChanged();
      refreshApprovals().catch(() => undefined);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  }

  const approve = () => run(() => api.post(`/instances/${instance.id}/approve`, {}), `Approved “${title}”`);

  const saveChanges = () =>
    run(
      () =>
        api.patch(`/instances/${instance.id}`, {
          dueAt: DateTime.fromISO(dueLocal, { zone: TZ }).toUTC().toISO(),
          assigneeUserId: assignee,
        }),
      'Updated',
    );

  async function removeOne() {
    const ok = await confirm({
      title: 'Skip this one?',
      body: `Removes only this “${title}” (${friendlyDue(instance!.dueAt)}). The chore keeps repeating.`,
      confirmLabel: 'Skip it',
      danger: true,
    });
    if (ok) run(() => api.delete(`/instances/${instance!.id}`), 'Removed');
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      subtitle={friendlyDue(instance.dueAt)}
      size="sm"
      footer={
        mode === 'reschedule' ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setMode('view')}>Back</button>
            <button type="button" className="btn btn-primary" onClick={saveChanges} disabled={busy}>Save</button>
          </>
        ) : instance.status === 'done' ? (
          <button type="button" className="btn btn-primary btn-block" onClick={approve} disabled={busy}>
            <Icon name="check" size={18} /> Approve{reward ? ` · ${money(reward, currency)}` : ''}
          </button>
        ) : undefined
      }
    >
      {mode === 'view' ? (
        <div className="stack">
          <div className="detail-row">
            <StatusPill instance={instance} />
            {reward && (
              <span className="pill pill-coin">
                <Icon name="coin" size={14} /> {money(reward, currency)}
              </span>
            )}
          </div>
          <div className="detail-people">
            {instance.assignments.map((a) => (
              <span key={a.userId} className="person">
                <Avatar user={{ id: a.userId, displayName: a.displayName }} size={28} />
                {a.displayName}
              </span>
            ))}
          </div>
          {doneAt && <p className="muted small">Marked done {relativeTime(doneAt)}</p>}
          {isOverdue(instance.dueAt, instance.status) && <p className="callout callout-warn">This is overdue.</p>}

          <div className="action-list">
            {editable && (
              <button type="button" className="action-item" onClick={() => setMode('reschedule')}>
                <Icon name="calendar" /> <span>Change time or who</span> <Icon name="chevronRight" size={18} />
              </button>
            )}
            <button type="button" className="action-item" onClick={() => onEditSeries(instance.choreId)}>
              <Icon name="repeat" /> <span>Edit the chore (all upcoming)</span> <Icon name="chevronRight" size={18} />
            </button>
            {editable && (
              <button type="button" className="action-item action-danger" onClick={removeOne}>
                <Icon name="trash" /> <span>Skip just this one</span>
              </button>
            )}
          </div>
          {error && <p className="callout callout-error">{error}</p>}
        </div>
      ) : (
        <div className="stack">
          <label className="field">
            <span className="field-label-sm">Due</span>
            <input className="input" type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
          </label>
          <div className="field">
            <span className="field-label-sm">Who</span>
            <div className="chip-row">
              {kids.map((kid) => (
                <button
                  key={kid.id}
                  type="button"
                  className={`chip chip-person ${assignee === kid.id ? 'is-on' : ''}`}
                  aria-pressed={assignee === kid.id}
                  onClick={() => setAssignee(kid.id)}
                >
                  <Avatar user={kid} size={26} /> {firstName(kid.displayName)}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="callout callout-error">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
