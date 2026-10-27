'use client';

import { DateTime } from 'luxon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { choreTitle, dayKey, firstName, friendlyDay, money, now, timeOf, zoned } from '../../lib/format';
import { useSession } from '../../lib/session';
import { rangeQuery, type Chore, type Earnings, type Instance } from '../../lib/types';
import { Avatar, ProgressRing } from '../../components/avatar';
import { Icon } from '../../components/icon';
import { statusOf } from '../../components/status';
import { EmptyState, errorMessage, Sheet, useUi } from '../../components/ui';

export default function KidPage() {
  const { me, kids, currency } = useSession();
  const { toast, confirm } = useUi();
  const isParent = me.role === 'parent';
  const [targetId, setTargetId] = useState<string>(isParent ? '' : me.id);
  const [items, setItems] = useState<Instance[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [walletOpen, setWalletOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isParent || targetId) return;
    const fromQuery = new URLSearchParams(window.location.search).get('user');
    const pick = kids.find((k) => k.id === fromQuery) || kids[0];
    if (pick) setTargetId(pick.id);
  }, [isParent, kids, targetId]);

  const target = isParent ? kids.find((k) => k.id === targetId) : me;
  const canCheck = targetId === me.id;

  const load = useCallback(async () => {
    if (!targetId) return;
    try {
      const start = now().startOf('day');
      const [instances, earned, choreList] = await Promise.all([
        api.get(rangeQuery(start.minus({ days: 7 }).toUTC().toISO() || '', start.plus({ days: 6 }).endOf('day').toUTC().toISO() || '', targetId)),
        api.get(`/users/${targetId}/earnings`),
        api.get('/chores').catch(() => []),
      ]);
      setItems(instances);
      setEarnings(earned);
      setChores(choreList);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Could not load your chores'));
    } finally {
      setLoaded(true);
    }
  }, [targetId]);

  useEffect(() => {
    setLoaded(false);
    load();
  }, [load]);

  const todayKey = now().toISODate() || '';
  const isMineDone = (i: Instance) => {
    const d = i.doneByUserId[targetId];
    return (!!d && !d.undoneAt) || i.status === 'approved';
  };
  const today = items.filter((i) => dayKey(i.dueAt) === todayKey);
  const missed = items.filter((i) => dayKey(i.dueAt) < todayKey && i.status === 'assigned');
  const upcoming = useMemo(() => {
    const groups: Record<string, Instance[]> = {};
    for (const i of items) if (dayKey(i.dueAt) > todayKey) (groups[dayKey(i.dueAt)] ||= []).push(i);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [items, todayKey]);
  const doneToday = today.filter(isMineDone).length;
  const rewardFor = (i: Instance) => {
    if (!i.chore.hasReward) return null;
    return i.rewardAmount || chores.find((c) => c.id === i.choreId)?.rewardAmount || null;
  };
  const waitingAmount = items
    .filter((i) => i.status === 'done')
    .reduce((sum, i) => sum + Number(rewardFor(i) || 0), 0);

  async function toggle(item: Instance) {
    if (!canCheck || item.status === 'approved' || pending.has(item.id)) return;
    const wasDone = isMineDone(item);
    const stamp = new Date().toISOString();
    // Optimistic: flip it right away so the tap feels instant.
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              status: wasDone ? 'assigned' : 'done',
              doneByUserId: { ...i.doneByUserId, [me.id]: { doneAt: stamp, undoneAt: wasDone ? stamp : null } },
            }
          : i,
      ),
    );
    setPending((prev) => new Set(prev).add(item.id));
    try {
      await api.post(`/instances/${item.id}/${wasDone ? 'undo' : 'mark-done'}`, {});
      if (!wasDone && dayKey(item.dueAt) === todayKey && doneToday + 1 === today.length) {
        setCelebrate(true);
        window.setTimeout(() => setCelebrate(false), 2200);
      }
    } catch (err) {
      toast(errorMessage(err, 'Could not update'), 'error');
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      load();
    }
  }

  async function markPaid() {
    if (!earnings || !target) return;
    const ok = await confirm({
      title: `Pay ${firstName(target.displayName)} ${money(earnings.dueAmount, earnings.currencyCode)}?`,
      body: 'Marks the full balance as paid and resets it to zero.',
      confirmLabel: 'Mark as paid',
    });
    if (!ok) return;
    try {
      await api.post(`/users/${targetId}/payout-reset`, {});
      toast('Balance marked as paid');
      load();
    } catch (err) {
      toast(errorMessage(err, 'Could not mark as paid'), 'error');
    }
  }

  if (isParent && kids.length === 0) {
    return (
      <div className="page">
        <EmptyState icon="users" title="No kids yet">Add kids on the Family page to see their view.</EmptyState>
      </div>
    );
  }

  const name = target ? firstName(target.displayName) : '';
  const left = today.length - doneToday;
  const heroLine =
    today.length === 0
      ? 'Nothing due today. Enjoy!'
      : left === 0
        ? 'All done for today — amazing!'
        : `${left} ${left === 1 ? 'chore' : 'chores'} left today`;

  return (
    <div className="kid-page">
      {isParent && (
        <div className="viewing-as">
          <span className="small">Viewing as</span>
          <div className="chip-row">
            {kids.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`chip chip-person ${k.id === targetId ? 'is-on' : ''}`}
                aria-pressed={k.id === targetId}
                onClick={() => setTargetId(k.id)}
              >
                <Avatar user={k} size={22} /> {firstName(k.displayName)}
              </button>
            ))}
          </div>
        </div>
      )}

      <section className="kid-hero">
        <ProgressRing value={doneToday} total={today.length} size={92} stroke={8}>
          <span className="hero-count">
            <strong>{doneToday}</strong>
            <span>/{today.length}</span>
          </span>
        </ProgressRing>
        <div>
          <h1>Hi {name}!</h1>
          <p>{heroLine}</p>
        </div>
      </section>

      {earnings && (
        <button type="button" className="wallet-tile" onClick={() => setWalletOpen(true)}>
          <span className="wallet-icon"><Icon name="coin" size={24} /></span>
          <span className="wallet-text">
            <span className="small">{isParent ? `${name}’s balance` : 'Your balance'}</span>
            <strong className="wallet-amount">{money(earnings.dueAmount, earnings.currencyCode)}</strong>
            {waitingAmount > 0 && (
              <span className="small">+{money(waitingAmount, earnings.currencyCode)} waiting for approval</span>
            )}
          </span>
          <Icon name="chevronRight" size={20} />
        </button>
      )}

      {error && <p className="callout callout-error">{error}</p>}
      {isParent && <p className="callout callout-info">Only {name} can check off chores, from their own login.</p>}

      {missed.length > 0 && (
        <section className="kid-section">
          <h2 className="kid-section-title kid-section-missed">
            <Icon name="alert" size={18} /> Missed — still time to do them
          </h2>
          <ul className="kid-list">
            {missed.map((item) => (
              <KidChore key={item.id} item={item} done={isMineDone(item)} reward={rewardFor(item)} currency={currency} disabled={!canCheck} onToggle={toggle} showDay />
            ))}
          </ul>
        </section>
      )}

      <section className="kid-section">
        <h2 className="kid-section-title">Today</h2>
        {!loaded ? (
          <div className="skeleton-list"><span /><span /></div>
        ) : today.length === 0 ? (
          <div className="list-card">
            <EmptyState icon="sparkle" title="Free day!">No chores today.</EmptyState>
          </div>
        ) : (
          <ul className="kid-list">
            {today.map((item) => (
              <KidChore key={item.id} item={item} done={isMineDone(item)} reward={rewardFor(item)} currency={currency} disabled={!canCheck} onToggle={toggle} />
            ))}
          </ul>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="kid-section">
          <h2 className="kid-section-title">Coming up</h2>
          {upcoming.map(([day, list]) => (
            <div key={day} className="upcoming-day">
              <h3>{friendlyDay(DateTime.fromISO(day, { zone: zoned(list[0].dueAt).zone }))}</h3>
              <ul className="kid-list kid-list-compact">
                {list.map((item) => (
                  <KidChore key={item.id} item={item} done={isMineDone(item)} reward={rewardFor(item)} currency={currency} disabled={!canCheck} onToggle={toggle} compact />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {celebrate && (
        <div className="celebrate" aria-live="polite">
          <div className="celebrate-burst">
            {Array.from({ length: 18 }, (_, i) => (
              <i key={i} style={{ ['--i' as any]: i }} />
            ))}
          </div>
          <p>All done today! 🎉</p>
        </div>
      )}

      <Sheet open={walletOpen} onClose={() => setWalletOpen(false)} title={isParent ? `${name}’s money` : 'Your money'}>
        {earnings && (
          <div className="stack-lg">
            <div className="wallet-stats">
              <div>
                <span className="small muted">To be paid</span>
                <strong>{money(earnings.dueAmount, earnings.currencyCode)}</strong>
              </div>
              <div>
                <span className="small muted">Earned all-time</span>
                <strong>{money(earnings.earnedTotal, earnings.currencyCode)}</strong>
              </div>
              <div>
                <span className="small muted">Paid out</span>
                <strong>{money(earnings.paidOutTotal, earnings.currencyCode)}</strong>
              </div>
            </div>
            {isParent && Number(earnings.dueAmount) > 0 && (
              <button type="button" className="btn btn-primary btn-block" onClick={markPaid}>
                <Icon name="wallet" size={18} /> Mark {money(earnings.dueAmount, earnings.currencyCode)} as paid
              </button>
            )}
            <div>
              <h3 className="field-label">History</h3>
              {earnings.earnEntries.length === 0 && earnings.payoutEntries.length === 0 ? (
                <p className="muted">Approved chores with rewards will show up here.</p>
              ) : (
                <ul className="ledger">
                  {[
                    ...earnings.earnEntries.map((e) => ({
                      id: e.id,
                      at: e.createdAt,
                      label: (target?.locale === 'he' ? e.choreTitleHe : e.choreTitleEn) || e.choreTitleEn || e.choreTitleHe || 'Chore',
                      amount: `+${money(e.amount, earnings.currencyCode)}`,
                      kind: 'earn',
                    })),
                    ...earnings.payoutEntries.map((p) => ({
                      id: p.id,
                      at: p.createdAt,
                      label: 'Paid out',
                      amount: `−${money(p.amount, earnings.currencyCode)}`,
                      kind: 'payout',
                    })),
                  ]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((row) => (
                      <li key={row.id} className={`ledger-row ledger-${row.kind}`}>
                        <span>
                          <span className="row-title">{row.label}</span>
                          <span className="small muted">{DateTime.fromISO(row.at).toFormat('EEE, LLL d')}</span>
                        </span>
                        <strong>{row.amount}</strong>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function KidChore({
  item,
  done,
  reward,
  currency,
  disabled,
  onToggle,
  compact,
  showDay,
}: {
  item: Instance;
  done: boolean;
  reward: string | null;
  currency: string;
  disabled: boolean;
  onToggle: (item: Instance) => void;
  compact?: boolean;
  showDay?: boolean;
}) {
  const state = statusOf(item);
  const approved = item.status === 'approved';
  const sub = approved
    ? 'Approved!'
    : done
      ? 'Waiting for a parent to approve'
      : `${showDay ? `${friendlyDay(zoned(item.dueAt))} · ` : ''}by ${timeOf(item.dueAt)}`;
  return (
    <li>
      <button
        type="button"
        className={`kid-chore ${compact ? 'is-compact' : ''} ${done ? 'is-done' : ''} ${approved ? 'is-approved' : ''} ${state === 'overdue' ? 'is-overdue' : ''}`}
        onClick={() => onToggle(item)}
        disabled={disabled || approved}
        aria-pressed={done}
      >
        <span className="kid-check" aria-hidden="true">
          {approved ? <Icon name="star" size={compact ? 16 : 20} /> : <Icon name="check" size={compact ? 16 : 22} />}
        </span>
        <span className="kid-chore-text">
          <span className="kid-chore-title">{choreTitle(item.chore)}</span>
          <span className="kid-chore-sub">{sub}</span>
        </span>
        {reward && (
          <span className="pill pill-coin">
            <Icon name="coin" size={14} /> {money(reward, currency)}
          </span>
        )}
      </button>
    </li>
  );
}
