'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { choreTitle, currencySymbol, firstName, friendlyDue, money, relativeTime } from '../../../lib/format';
import { joinNames, t, tn } from '../../../lib/i18n';
import { approvalsRange, useSession } from '../../../lib/session';
import { activeDoneAt, rangeQuery, type Chore, type Instance } from '../../../lib/types';
import { Avatar } from '../../../components/avatar';
import { ChoreEditor } from '../../../components/chore-editor';
import { Icon } from '../../../components/icon';
import { InstanceSheet } from '../../../components/instance-sheet';
import { statusOf } from '../../../components/status';
import { EmptyState, errorMessage, useUi } from '../../../components/ui';

export default function ApprovalsPage() {
  const { currency, refreshApprovals } = useSession();
  const { toast } = useUi();
  const [items, setItems] = useState<Instance[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [rewards, setRewards] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [openInstance, setOpenInstance] = useState<Instance | null>(null);
  const [editorChoreId, setEditorChoreId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { from, to } = approvalsRange();
      const [instances, choreList] = await Promise.all([api.get(rangeQuery(from, to)), api.get('/chores')]);
      setItems(instances);
      setChores(choreList);
      setError('');
    } catch (err) {
      setError(errorMessage(err, t('approvals.couldNotLoad')));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const waiting = items
    .filter((i) => i.status === 'done')
    .sort((a, b) => (activeDoneAt(b) || '').localeCompare(activeDoneAt(a) || ''));
  const overdue = items.filter((i) => statusOf(i) === 'overdue').sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const defaultReward = (item: Instance) => {
    const amount = chores.find((c) => c.id === item.choreId)?.rewardAmount;
    return amount ? String(Number(amount)) : '';
  };
  const rewardValue = (item: Instance) => rewards[item.id] ?? defaultReward(item);

  async function approve(item: Instance, quiet = false) {
    const reward = rewardValue(item);
    if (item.chore.hasReward && !(Number(reward) > 0)) {
      setError(t('approvals.enterReward', { chore: choreTitle(item.chore) }));
      return false;
    }
    setBusy((prev) => new Set(prev).add(item.id));
    try {
      await api.post(`/instances/${item.id}/approve`, item.chore.hasReward ? { rewardAmount: reward } : {});
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'approved' } : i)));
      if (!quiet) {
        const who = firstName(item.assignments[0]?.displayName || '');
        toast(
          item.chore.hasReward
            ? t('approvals.approvedEarned', { who, amount: money(reward, currency) })
            : t('approvals.approvedChore', { who, chore: choreTitle(item.chore) }),
        );
      }
      return true;
    } catch (err) {
      setError(errorMessage(err, t('approvals.failed')));
      return false;
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      refreshApprovals().catch(() => undefined);
    }
  }

  async function approveAll() {
    let count = 0;
    for (const item of waiting) {
      if (await approve(item, true)) count += 1;
    }
    if (count) toast(tn('approvals.approvedCount', count));
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t('approvals.title')}</h1>
          <p className="muted">{t('approvals.subtitle')}</p>
        </div>
        {waiting.length > 1 && (
          <button type="button" className="btn btn-primary" onClick={approveAll} disabled={busy.size > 0}>
            <Icon name="check" size={18} /> {t('approvals.approveAll', { count: waiting.length })}
          </button>
        )}
      </header>

      {error && <p className="callout callout-error" role="alert">{error}</p>}

      <section className="section">
        <div className="section-head">
          <h2>{t('approvals.waitingForYou')}</h2>
          {waiting.length > 0 && <span className="count-badge">{waiting.length}</span>}
        </div>
        {!loaded ? (
          <div className="list-card"><div className="skeleton-list"><span /><span /></div></div>
        ) : waiting.length === 0 ? (
          <div className="list-card">
            <EmptyState icon="approve" title={t('approvals.caughtUp')}>
              {t('approvals.caughtUpHint')}
            </EmptyState>
          </div>
        ) : (
          <ul className="approval-list">
            {waiting.map((item) => {
              const kid = item.assignments[0];
              const doneAt = activeDoneAt(item);
              return (
                <li key={item.id} className="approval-card">
                  <div className="approval-main">
                    {kid && <Avatar user={{ id: kid.userId, displayName: kid.displayName }} size={40} />}
                    <div className="approval-text">
                      <p className="row-title">{choreTitle(item.chore)}</p>
                      <p className="small muted">
                        {[
                          joinNames(item.assignments.map((a) => firstName(a.displayName))),
                          doneAt ? t('approvals.doneAgo', { time: relativeTime(doneAt) }) : null,
                          t('approvals.due', { when: friendlyDue(item.dueAt) }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="approval-actions">
                    {item.chore.hasReward && (
                      <label className="money-input money-input-sm">
                        <span>{currencySymbol(currency)}</span>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={rewardValue(item)}
                          onChange={(e) => setRewards((prev) => ({ ...prev, [item.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                          aria-label={t('approvals.rewardAmount')}
                        />
                      </label>
                    )}
                    <button type="button" className="icon-btn icon-btn-outline" onClick={() => setOpenInstance(item)} aria-label={t('common.moreOptions')}>
                      <Icon name="more" />
                    </button>
                    <button type="button" className="btn btn-success" onClick={() => approve(item)} disabled={busy.has(item.id)}>
                      <Icon name="check" size={18} /> {t('common.approve')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section" id="overdue">
        <div className="section-head">
          <h2>{t('approvals.overdue')}</h2>
          {overdue.length > 0 && <span className="count-badge count-badge-danger">{overdue.length}</span>}
        </div>
        <div className="list-card">
          {loaded && overdue.length === 0 ? (
            <EmptyState icon="clock" title={t('approvals.nothingOverdue')}>{t('approvals.nothingOverdueHint')}</EmptyState>
          ) : (
            <ul className="rows">
              {overdue.map((item) => (
                <li key={item.id}>
                  <button type="button" className="row row-overdue" onClick={() => setOpenInstance(item)}>
                    {item.assignments[0] && (
                      <Avatar user={{ id: item.assignments[0].userId, displayName: item.assignments[0].displayName }} size={32} />
                    )}
                    <span className="row-main">
                      <span className="row-title">{choreTitle(item.chore)}</span>
                      <span className="row-sub">
                        {joinNames(item.assignments.map((a) => firstName(a.displayName)))} ·{' '}
                        {t('approvals.wasDue', { when: friendlyDue(item.dueAt) })}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={18} className="row-chevron" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <InstanceSheet
        instance={openInstance}
        onClose={() => setOpenInstance(null)}
        onChanged={load}
        onEditSeries={(id) => {
          setOpenInstance(null);
          setEditorChoreId(id);
        }}
        rewardFor={(id) => chores.find((c) => c.id === id)?.rewardAmount ?? null}
      />
      <ChoreEditor open={!!editorChoreId} choreId={editorChoreId} onClose={() => setEditorChoreId(null)} onSaved={load} />
    </div>
  );
}
