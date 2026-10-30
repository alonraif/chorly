'use client';

import { DateTime } from 'luxon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { choreTitle, dayKey, firstName, friendlyDay, money, now, shortDate, timeOf, zoned } from '../../lib/format';
import { getLocale, t, tn } from '../../lib/i18n';
import { useAutoRefresh } from '../../lib/refresh';
import { useSession } from '../../lib/session';
import { rangeQuery, type Chore, type Earnings, type Instance } from '../../lib/types';
import { Avatar, ProgressRing } from '../../components/avatar';
import { Icon } from '../../components/icon';
import { ProofSheet } from '../../components/proof-sheet';
import { statusOf } from '../../components/status';
import { EmptyState, errorMessage, Sheet, useUi } from '../../components/ui';

export default function KidPage() {
  const { me, people, currency } = useSession();
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
  const [capturing, setCapturing] = useState<Instance | null>(null);

  useEffect(() => {
    if (!isParent || targetId || people.length === 0) return;
    const fromQuery = new URLSearchParams(window.location.search).get('user');
    setTargetId(people.find((p) => p.id === fromQuery)?.id || me.id);
  }, [isParent, people, targetId, me.id]);

  const target = isParent ? people.find((p) => p.id === targetId) : me;
  const canCheck = targetId === me.id;
  const viewingOther = isParent && !canCheck;

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
      setError(errorMessage(err, t('kid.couldNotLoad')));
    } finally {
      setLoaded(true);
    }
  }, [targetId]);

  useEffect(() => {
    setLoaded(false);
    load();
  }, [load]);
  useAutoRefresh(load);

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

  function celebrateIfLast(item: Instance) {
    if (dayKey(item.dueAt) !== todayKey || doneToday + 1 !== today.length) return;
    setCelebrate(true);
    window.setTimeout(() => setCelebrate(false), 2200);
  }

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
      if (!wasDone) celebrateIfLast(item);
    } catch (err) {
      toast(errorMessage(err, t('kid.couldNotUpdate')), 'error');
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
      title: t('common.payConfirmTitle', { name: firstName(target.displayName), amount: money(earnings.dueAmount, earnings.currencyCode) }),
      body: t('common.payConfirmBody'),
      confirmLabel: t('common.markAsPaid'),
    });
    if (!ok) return;
    try {
      await api.post(`/users/${targetId}/payout-reset`, {});
      toast(t('kid.balancePaid'));
      load();
    } catch (err) {
      toast(errorMessage(err, t('common.couldNotMarkPaid')), 'error');
    }
  }

  const name = target ? firstName(target.displayName) : '';
  const left = today.length - doneToday;
  const heroLine =
    today.length === 0
      ? t('kid.nothingToday')
      : left === 0
        ? t('kid.allDoneToday')
        : tn('kid.left', left);

  return (
    <div className="kid-page">
      {isParent && (
        <div className="viewing-as">
          <span className="small">{t('kid.viewingAs')}</span>
          <div className="chip-row">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip chip-person ${p.id === targetId ? 'is-on' : ''}`}
                aria-pressed={p.id === targetId}
                onClick={() => setTargetId(p.id)}
              >
                <Avatar user={p} size={22} /> {firstName(p.displayName)}
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
          <h1>{t('kid.hi', { name })}</h1>
          <p>{heroLine}</p>
        </div>
      </section>

      {earnings && (
        <button type="button" className="wallet-tile" onClick={() => setWalletOpen(true)}>
          <span className="wallet-icon"><Icon name="coin" size={24} /></span>
          <span className="wallet-text">
            <span className="small">{viewingOther ? t('kid.theirBalance', { name }) : t('kid.yourBalance')}</span>
            <strong className="wallet-amount">{money(earnings.dueAmount, earnings.currencyCode)}</strong>
            {waitingAmount > 0 && (
              <span className="small">{t('kid.waitingAmount', { amount: money(waitingAmount, earnings.currencyCode) })}</span>
            )}
          </span>
          <Icon name="chevronRight" size={20} />
        </button>
      )}

      {error && <p className="callout callout-error">{error}</p>}
      {viewingOther && <p className="callout callout-info">{t('kid.onlyThem', { name })}</p>}

      {missed.length > 0 && (
        <section className="kid-section">
          <h2 className="kid-section-title kid-section-missed">
            <Icon name="alert" size={18} /> {t('kid.missed')}
          </h2>
          <ul className="kid-list">
            {missed.map((item) => (
              <KidChore key={item.id} item={item} done={isMineDone(item)} reward={rewardFor(item)} currency={currency} disabled={!canCheck} onToggle={toggle} onCapture={setCapturing} showDay />
            ))}
          </ul>
        </section>
      )}

      <section className="kid-section">
        <h2 className="kid-section-title">{t('common.today')}</h2>
        {!loaded ? (
          <div className="skeleton-list"><span /><span /></div>
        ) : today.length === 0 ? (
          <div className="list-card">
            <EmptyState icon="sparkle" title={t('kid.freeDay')}>{t('kid.noChoresToday')}</EmptyState>
          </div>
        ) : (
          <ul className="kid-list">
            {today.map((item) => (
              <KidChore key={item.id} item={item} done={isMineDone(item)} reward={rewardFor(item)} currency={currency} disabled={!canCheck} onToggle={toggle} onCapture={setCapturing} />
            ))}
          </ul>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="kid-section">
          <h2 className="kid-section-title">{t('kid.comingUp')}</h2>
          {upcoming.map(([day, list]) => (
            <div key={day} className="upcoming-day">
              <h3>{friendlyDay(DateTime.fromISO(day, { zone: zoned(list[0].dueAt).zone }))}</h3>
              <ul className="kid-list kid-list-compact">
                {list.map((item) => (
                  <KidChore key={item.id} item={item} done={isMineDone(item)} reward={rewardFor(item)} currency={currency} disabled={!canCheck} onToggle={toggle} onCapture={setCapturing} compact />
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
          <p>{t('kid.celebrate')}</p>
        </div>
      )}

      <ProofSheet
        instance={capturing}
        onClose={() => setCapturing(null)}
        onDone={(item) => {
          toast(t('proof.sent'));
          celebrateIfLast(item);
          load();
        }}
      />

      <Sheet open={walletOpen} onClose={() => setWalletOpen(false)} title={viewingOther ? t('kid.theirMoney', { name }) : t('kid.yourMoney')}>
        {earnings && (
          <div className="stack-lg">
            <div className="wallet-stats">
              <div>
                <span className="small muted">{t('kid.toBePaid')}</span>
                <strong>{money(earnings.dueAmount, earnings.currencyCode)}</strong>
              </div>
              <div>
                <span className="small muted">{t('kid.earnedAll')}</span>
                <strong>{money(earnings.earnedTotal, earnings.currencyCode)}</strong>
              </div>
              <div>
                <span className="small muted">{t('kid.paidOut')}</span>
                <strong>{money(earnings.paidOutTotal, earnings.currencyCode)}</strong>
              </div>
            </div>
            {isParent && Number(earnings.dueAmount) > 0 && (
              <button type="button" className="btn btn-primary btn-block" onClick={markPaid}>
                <Icon name="wallet" size={18} /> {t('kid.markAmountPaid', { amount: money(earnings.dueAmount, earnings.currencyCode) })}
              </button>
            )}
            <div>
              <h3 className="field-label">{t('kid.history')}</h3>
              {earnings.earnEntries.length === 0 && earnings.payoutEntries.length === 0 ? (
                <p className="muted">{t('kid.historyEmpty')}</p>
              ) : (
                <ul className="ledger">
                  {[
                    ...earnings.earnEntries.map((e) => ({
                      id: e.id,
                      at: e.createdAt,
                      label: (getLocale() === 'he' ? e.choreTitleHe : e.choreTitleEn) || e.choreTitleEn || e.choreTitleHe || t('common.chore'),
                      amount: `+${money(e.amount, earnings.currencyCode)}`,
                      kind: 'earn',
                    })),
                    ...earnings.payoutEntries.map((p) => ({
                      id: p.id,
                      at: p.createdAt,
                      label: t('kid.paidOut'),
                      amount: `−${money(p.amount, earnings.currencyCode)}`,
                      kind: 'payout',
                    })),
                  ]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((row) => (
                      <li key={row.id} className={`ledger-row ledger-${row.kind}`}>
                        <span>
                          <span className="row-title">{row.label}</span>
                          <span className="small muted">{shortDate(DateTime.fromISO(row.at))}</span>
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
  onCapture,
  compact,
  showDay,
}: {
  item: Instance;
  done: boolean;
  reward: string | null;
  currency: string;
  disabled: boolean;
  onToggle: (item: Instance) => void;
  onCapture: (item: Instance) => void;
  compact?: boolean;
  showDay?: boolean;
}) {
  const state = statusOf(item);
  const approved = item.status === 'approved';
  const sub = approved
    ? t('kid.approved')
    : done
      ? t('kid.waitingParent')
      : `${showDay ? `${friendlyDay(zoned(item.dueAt))} · ` : ''}${t('kid.by', { time: timeOf(item.dueAt) })}`;
  return (
    <li className="kid-chore-row">
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
      {!disabled && item.status === 'assigned' && (
        <button
          type="button"
          className={`kid-proof ${compact ? 'is-compact' : ''}`}
          onClick={() => onCapture(item)}
          aria-label={t('proof.addFor', { chore: choreTitle(item.chore) })}
        >
          <Icon name="camera" size={compact ? 18 : 22} />
        </button>
      )}
    </li>
  );
}
