'use client';

import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { choreTitle, firstName, friendlyDue, isOverdue, money, relativeTime, TZ } from '../lib/format';
import { t } from '../lib/i18n';
import { placeBlockedText } from '../lib/places';
import { useSession } from '../lib/session';
import { activeDoneAt, approvesOwnChore, type Instance } from '../lib/types';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { ProofList } from './proof-list';
import { ProofSheet } from './proof-sheet';
import { RejectSheet } from './reject-sheet';
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
  const { me, people, currency, refreshApprovals } = useSession();
  const { toast, confirm } = useUi();
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [rejecting, setRejecting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [dueLocal, setDueLocal] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!instance) return;
    setMode('view');
    setRejecting(false);
    setFinishing(false);
    setError('');
    setDueLocal(DateTime.fromISO(instance.dueAt).setZone(TZ).toFormat("yyyy-LL-dd'T'HH:mm"));
    setAssignee(instance.assignments[0]?.userId || '');
  }, [instance]);

  if (!instance) return null;
  const title = choreTitle(instance.chore);
  const doneAt = activeDoneAt(instance);
  const forKid = instance.assignments.some((a) => people.find((p) => p.id === a.userId)?.role === 'child');
  const reward = forKid ? instance.rewardAmount || rewardFor?.(instance.choreId) || null : null;
  const editable = instance.status !== 'approved';
  const canMarkDone = instance.status === 'assigned' && instance.assignments.some((a) => a.userId === me.id);
  // Who's on a shared chore is changed on the series: picking one person here would drop the others.
  const shared = instance.assignments.length > 1;

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
      const blocked = placeBlockedText(err, instance?.chore.place);
      setError(blocked ?? errorMessage(err, t('common.somethingWrong')));
      if (blocked) toast(blocked, 'error');
    } finally {
      setBusy(false);
    }
  }

  const approve = () => run(() => api.post(`/instances/${instance.id}/approve`, {}), t('instance.approvedChore', { chore: title }));
  const markDone = () => run(() => api.post(`/instances/${instance.id}/mark-done`, {}), t('instance.updated'));

  const saveChanges = () =>
    run(
      () =>
        api.patch(`/instances/${instance.id}`, {
          dueAt: DateTime.fromISO(dueLocal, { zone: TZ }).toUTC().toISO(),
          assigneeUserId: shared ? undefined : assignee,
        }),
      t('instance.updated'),
    );

  async function removeOne() {
    const ok = await confirm({
      title: t('instance.skipTitle'),
      body: t('instance.skipBody', { chore: title, when: friendlyDue(instance!.dueAt) }),
      confirmLabel: t('instance.skipConfirm'),
      danger: true,
    });
    if (ok) run(() => api.delete(`/instances/${instance!.id}`), t('instance.removed'));
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
            <button type="button" className="btn btn-secondary" onClick={() => setMode('view')}>{t('common.back')}</button>
            <button type="button" className="btn btn-primary" onClick={saveChanges} disabled={busy}>{t('common.save')}</button>
          </>
        ) : instance.status === 'done' ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setRejecting(true)} disabled={busy}>
              <Icon name="x" size={18} /> {t('common.reject')}
            </button>
            <button type="button" className="btn btn-primary" onClick={approve} disabled={busy}>
              <Icon name="check" size={18} /> {t('common.approve')}
              {reward ? ` · ${money(reward, currency)}` : ''}
            </button>
          </>
        ) : canMarkDone ? (
          <button type="button" className="btn btn-primary" onClick={() => (approvesOwnChore(instance, me) ? markDone() : setFinishing(true))} disabled={busy}>
            <Icon name="check" size={18} /> {t('instance.markDone')}
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
          {doneAt && <p className="muted small">{t('instance.markedDone', { time: relativeTime(doneAt) })}</p>}
          {instance.chore.place && canMarkDone && !me.isAdmin && (
            <p className="callout">
              {t(instance.chore.place.rule === 'visited' ? 'instance.placeVisited' : 'instance.placeAt', { place: instance.chore.place.name })}
            </p>
          )}
          {isOverdue(instance.dueAt, instance.status) && <p className="callout callout-warn">{t('instance.overdue')}</p>}
          <ProofList instance={instance} />

          <div className="action-list">
            {editable && (
              <button type="button" className="action-item" onClick={() => setMode('reschedule')}>
                <Icon name="calendar" /> <span>{t('instance.change')}</span> <Icon name="chevronRight" size={18} />
              </button>
            )}
            <button type="button" className="action-item" onClick={() => onEditSeries(instance.choreId)}>
              <Icon name="repeat" /> <span>{t('instance.editSeries')}</span> <Icon name="chevronRight" size={18} />
            </button>
            {editable && (
              <button type="button" className="action-item action-danger" onClick={removeOne}>
                <Icon name="trash" /> <span>{t('instance.skipOne')}</span>
              </button>
            )}
          </div>
          {error && <p className="callout callout-error">{error}</p>}
        </div>
      ) : (
        <div className="stack">
          <label className="field">
            <span className="field-label-sm">{t('instance.due')}</span>
            <input className="input" type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
          </label>
          {!shared && (
            <div className="field">
              <span className="field-label-sm">{t('instance.who')}</span>
              <div className="chip-row">
                {people.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className={`chip chip-person ${assignee === person.id ? 'is-on' : ''}`}
                    aria-pressed={assignee === person.id}
                    onClick={() => setAssignee(person.id)}
                  >
                    <Avatar user={person} size={26} /> {firstName(person.displayName)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="callout callout-error">{error}</p>}
        </div>
      )}
      <ProofSheet
        instance={finishing ? instance : null}
        onClose={() => setFinishing(false)}
        onMarkDone={markDone}
        onDone={() => {
          toast(t('proof.sent'));
          onChanged();
          refreshApprovals().catch(() => undefined);
          onClose();
        }}
      />
      <RejectSheet
        instance={rejecting ? instance : null}
        onClose={() => setRejecting(false)}
        onRejected={() => {
          onChanged();
          onClose();
        }}
      />
    </Sheet>
  );
}
